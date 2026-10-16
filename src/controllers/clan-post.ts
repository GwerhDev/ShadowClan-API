import { Router, type Request, type Response } from 'express';
import ClanPost from '../models/ClanPost';
import Character from '../models/Character';
import Clan from '../models/Clan';
import ShadowWar from '../models/ShadowWar';
import AccursedTower from '../models/AccursedTower';
import { message } from '../messages';
import { getUser } from '../helpers/getUser';
import { isSystemAdmin, ownsCharacter, isLeaderOrOfficerOf, sameId } from '../helpers/clanScope';
import type { ClanPostSource, IUser } from '../types';
import { handleError, parse } from '../helpers/http';
import * as V from '../validation/schemas';

// Editar/eliminar: admin de sistema, o el personaje activo es líder/oficial del clan del post.
async function canModerate(user: IUser, postClan: unknown, characterId: string | undefined): Promise<boolean> {
  if (isSystemAdmin(user)) return true;
  if (!ownsCharacter(user, characterId)) return false;
  return isLeaderOrOfficerOf(characterId, postClan);
}

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
  } catch (err) {
    handleError(res, err);
  }
});

router.post('/', async (req: Request, res: Response): Promise<void> => {
  try {
    const user = await getUser(req);
    if (!user) { res.status(401).json({ message: message.user.unauthorized }); return; }

    const { content, characterId, source, referenceId } = parse(V.clanPostCreate, req.body);

    const hasReference = source === 'shadow_war' || source === 'accursed_tower';
    if (!content?.trim() && !hasReference) { res.status(400).json({ message: 'El contenido no puede estar vacío.' }); return; }

    const charIds = user.character.map(String);
    if (!characterId || !charIds.includes(characterId)) { res.status(403).json({ message: 'No tienes acceso a este personaje.' }); return; }

    const char = await Character.findById(characterId).select('clan');
    if (!char?.clan) { res.status(400).json({ message: 'El personaje no pertenece a ningún clan.' }); return; }

    const resolvedSource: ClanPostSource = VALID_SOURCES.includes(source as ClanPostSource) ? (source as ClanPostSource) : 'general';
    if (resolvedSource !== 'general') {
      // La referencia debe existir y ser del mismo clan.
      const RefModel = resolvedSource === 'shadow_war' ? ShadowWar : AccursedTower;
      const ref = referenceId ? await (RefModel as typeof ShadowWar).findById(referenceId).select('clan').lean() : null;
      if (!ref || !sameId(ref.clan, char.clan)) { res.status(400).json({ message: 'Referencia inválida.' }); return; }
    }
    const post = await ClanPost.create({ clan: char.clan, author: characterId, content: (content ?? '').trim(), source: resolvedSource, referenceId: referenceId ?? null });
    const populated = await ClanPost.findById(post._id).populate('author', 'name currentClass resonance').lean();
    res.status(201).json(populated);
  } catch (err) {
    handleError(res, err);
  }
});

router.patch('/:id', async (req: Request, res: Response): Promise<void> => {
  try {
    const user = await getUser(req);
    if (!user) { res.status(401).json({ message: message.user.unauthorized }); return; }

    const post = await ClanPost.findById(req.params.id);
    if (!post) { res.status(404).json({ message: 'Publicación no encontrada.' }); return; }

    const { content, characterId } = parse(V.clanPostPatch, req.body);

    if (!(await canModerate(user, post.clan, characterId))) { res.status(403).json({ message: 'No tienes permisos para editar esta publicación.' }); return; }

    post.content = content.trim();
    await post.save();
    const updated = await ClanPost.findById(post._id).populate('author', 'name currentClass resonance').lean();
    res.status(200).json(updated);
  } catch (err) {
    handleError(res, err);
  }
});

router.delete('/:id', async (req: Request, res: Response): Promise<void> => {
  try {
    const user = await getUser(req);
    if (!user) { res.status(401).json({ message: message.user.unauthorized }); return; }

    const post = await ClanPost.findById(req.params.id);
    if (!post) { res.status(404).json({ message: 'Publicación no encontrada.' }); return; }

    if (!(await canModerate(user, post.clan, req.query.characterId as string | undefined))) { res.status(403).json({ message: 'No tienes permisos para eliminar esta publicación.' }); return; }

    await ClanPost.findByIdAndDelete(req.params.id);
    res.status(200).json({ message: 'Publicación eliminada.' });
  } catch (err) {
    handleError(res, err);
  }
});

export default router;
