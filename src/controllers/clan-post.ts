import { Router, type Request, type Response } from 'express';
import ClanPost from '../models/ClanPost';
import Character from '../models/Character';
import Clan from '../models/Clan';
import ShadowWar from '../models/ShadowWar';
import AccursedTower from '../models/AccursedTower';
import { message } from '../messages';
import { getUser } from '../helpers/getUser';
import type { ClanPostSource } from '../types';

const router = Router();
const VALID_SOURCES: ClanPostSource[] = ['general', 'shadow_war', 'accursed_tower'];

router.get('/', async (req: Request, res: Response): Promise<void> => {
  try {
    const user = await getUser(req);
    if (!user) { res.status(401).json({ message: message.user.unauthorized }); return; }

    const charIds = user.character.map(String);
    const { characterId, page: rawPage } = req.query as { characterId?: string; page?: string };
    if (!characterId || !charIds.includes(characterId)) { res.status(200).json([]); return; }

    const char = await Character.findById(characterId).select('clan');
    if (!char?.clan) { res.status(200).json([]); return; }

    const page  = Math.max(1, parseInt(rawPage ?? '1', 10));
    const limit = 20;

    const [posts, clan] = await Promise.all([
      ClanPost.find({ clan: char.clan }).sort({ createdAt: -1 }).skip((page - 1) * limit).limit(limit)
        .populate('author', 'name currentClass resonance').lean(),
      Clan.findById(char.clan).select('leader officer').lean(),
    ]);

    const leaderStr  = String(clan?.leader ?? '');
    const officerSet = new Set((clan?.officer ?? []).map(String));

    const base = posts.map(post => {
      const authorId   = String((post.author as { _id: unknown } | null)?._id ?? '');
      const authorRole = authorId === leaderStr ? 'leader' : officerSet.has(authorId) ? 'officer' : 'member';
      return { ...post, authorRole };
    });

    const swIds    = base.filter(p => p.source === 'shadow_war'    && p.referenceId).map(p => p.referenceId);
    const towerIds = base.filter(p => p.source === 'accursed_tower' && p.referenceId).map(p => p.referenceId);

    const [shadowWars, towers] = await Promise.all([
      swIds.length    ? ShadowWar.find({ _id: { $in: swIds } }).select('confirmed date enemyClan').populate('enemyClan', 'name').lean()    : [],
      towerIds.length ? AccursedTower.find({ _id: { $in: towerIds } }).select('confirmed date towerNumber enemyClan').populate('enemyClan', 'name').lean() : [],
    ]);

    const swMap    = Object.fromEntries(shadowWars.map(sw => [String(sw._id), sw]));
    const towerMap = Object.fromEntries(towers.map(t => [String(t._id), t]));

    const result = base.map(post => {
      if (post.source === 'shadow_war' && post.referenceId) {
        const sw = swMap[String(post.referenceId)] as (typeof shadowWars)[0] & { enemyClan?: { name?: string } } | undefined;
        return { ...post, instanceConfirmed: (sw?.confirmed ?? []).map(String), instanceDate: sw?.date, instanceEnemyClan: sw?.enemyClan?.name ?? null };
      }
      if (post.source === 'accursed_tower' && post.referenceId) {
        const t = towerMap[String(post.referenceId)] as (typeof towers)[0] & { enemyClan?: { name?: string } } | undefined;
        return { ...post, instanceConfirmed: (t?.confirmed ?? []).map(String), instanceDate: t?.date, instanceEnemyClan: t?.enemyClan?.name ?? null, instanceTowerNumber: t?.towerNumber ?? null };
      }
      return post;
    });

    res.status(200).json(result);
  } catch (error) {
    console.error(error);
    res.status(500).json({ error: message.user.error });
  }
});

router.post('/', async (req: Request, res: Response): Promise<void> => {
  try {
    const user = await getUser(req);
    if (!user) { res.status(401).json({ message: message.user.unauthorized }); return; }

    const { content, characterId, source, referenceId } = req.body as {
      content?: string; characterId?: string; source?: string; referenceId?: string;
    };

    const hasReference = source === 'shadow_war' || source === 'accursed_tower';
    if (!content?.trim() && !hasReference) { res.status(400).json({ message: 'El contenido no puede estar vacío.' }); return; }

    const charIds = user.character.map(String);
    if (!characterId || !charIds.includes(characterId)) { res.status(403).json({ message: 'No tienes acceso a este personaje.' }); return; }

    const char = await Character.findById(characterId).select('clan');
    if (!char?.clan) { res.status(400).json({ message: 'El personaje no pertenece a ningún clan.' }); return; }

    const resolvedSource: ClanPostSource = VALID_SOURCES.includes(source as ClanPostSource) ? (source as ClanPostSource) : 'general';
    const post = await ClanPost.create({ clan: char.clan, author: characterId, content: (content ?? '').trim(), source: resolvedSource, referenceId: referenceId ?? null });
    const populated = await ClanPost.findById(post._id).populate('author', 'name currentClass resonance').lean();
    res.status(201).json(populated);
  } catch (error) {
    console.error(error);
    res.status(500).json({ error: message.user.error });
  }
});

router.patch('/:id', async (req: Request, res: Response): Promise<void> => {
  try {
    const user = await getUser(req);
    if (!user) { res.status(401).json({ message: message.user.unauthorized }); return; }

    const post = await ClanPost.findById(req.params.id).populate('clan', 'leader officer');
    if (!post) { res.status(404).json({ message: 'Publicación no encontrada.' }); return; }

    const { content } = req.body as { content?: unknown };
    if (content === undefined) { res.status(400).json({ message: 'Se requiere el campo content.' }); return; }

    const charIds  = user.character.map(String);
    const clan     = post.clan as unknown as { leader: unknown; officer?: unknown[] };
    const isAdmin  = user.role === 'admin' || user.role === 'super_admin';
    const isPrivileged = charIds.includes(String(clan.leader)) || (clan.officer ?? []).some(o => charIds.includes(String(o)));

    if (!isAdmin && !isPrivileged) { res.status(403).json({ message: 'No tienes permisos para editar esta publicación.' }); return; }

    post.content = ((content as string | undefined) ?? '').trim();
    await post.save();
    const updated = await ClanPost.findById(post._id).populate('author', 'name currentClass resonance').lean();
    res.status(200).json(updated);
  } catch (error) {
    console.error(error);
    res.status(500).json({ error: message.user.error });
  }
});

router.delete('/:id', async (req: Request, res: Response): Promise<void> => {
  try {
    const user = await getUser(req);
    if (!user) { res.status(401).json({ message: message.user.unauthorized }); return; }

    const post = await ClanPost.findById(req.params.id).populate('clan', 'leader officer');
    if (!post) { res.status(404).json({ message: 'Publicación no encontrada.' }); return; }

    const charIds  = user.character.map(String);
    const clan     = post.clan as unknown as { leader: unknown; officer?: unknown[] };
    const isAdmin  = user.role === 'admin' || user.role === 'super_admin';
    const isPrivileged = charIds.includes(String(clan.leader)) || (clan.officer ?? []).some(o => charIds.includes(String(o)));

    if (!isAdmin && !isPrivileged) { res.status(403).json({ message: 'No tienes permisos para eliminar esta publicación.' }); return; }

    await ClanPost.findByIdAndDelete(req.params.id);
    res.status(200).json({ message: 'Publicación eliminada.' });
  } catch (error) {
    console.error(error);
    res.status(500).json({ error: message.user.error });
  }
});

export default router;
