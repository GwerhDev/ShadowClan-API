import { Router, type Request, type Response } from 'express';
import User from '../models/User';
import Character from '../models/Character';
import { message } from '../messages';
import { requireAuth } from '../middlewares';
import { escapeRegex, ownsCharacter } from '../helpers/clanScope';
import { characterConsts } from '../misc/consts-models';
import { mergedScore } from '../helpers/score';
import ClanMembership from '../models/ClanMembership';
import { handleError } from '../helpers/http';

const router = Router();

router.use(requireAuth);

// Campos públicos de un personaje (sin datos de contacto).
const PUBLIC_CHAR_FIELDS = 'name currentClass resonance armor armorPenetration power resistance score status memberStatus clan';

router.get('/', async (req: Request, res: Response): Promise<void> => {
  try {
    const user = await User.findById(req.user!._id)
      .populate('character')
      .populate({ path: 'character', populate: { path: 'clan' } });
    if (!user) { res.status(404).json({ logged: false, message: message.user.notfound }); return; }
    res.status(200).json(user.character);
  } catch (err) {
    handleError(res, err);
  }
});

router.post('/create', async (req: Request, res: Response): Promise<void> => {
  try {
    const user = req.user!;

    // El clan NO se acepta desde el body: la afiliación pasa por solicitudes/invitaciones.
    const { currentClass, resonance } = (req.body ?? {}) as Record<string, string | undefined>;
    const name = String((req.body ?? {}).name ?? '').trim();
    if (!name) { res.status(400).json({ message: 'Name is required' }); return; }

    const exists = await Character.findOne({ name: { $regex: `^${escapeRegex(name)}$`, $options: 'i' } });
    if (exists?.status === characterConsts.status.claimed || exists?.status === characterConsts.status.pending) {
      res.status(409).json({ message: 'Character already claimed' }); return;
    }
    if (exists?.status === characterConsts.status.unclaimed) {
      res.status(409).json({ message: 'Character already exists, but not claimed', characterId: exists._id }); return;
    }

    const newChar = await Character.create({ name, currentClass, resonance, status: characterConsts.status.claimed });
    await User.updateOne({ _id: user._id }, { $push: { character: newChar._id } });
    const updatedUser = await User.findById(user._id).populate('character');

    res.status(201).json({ message: message.character.create.success, character: newChar, user: updatedUser });
  } catch (err) {
    if ((err as { code?: number }).code === 11000) { res.status(409).json({ message: 'Ese nombre de personaje ya existe.' }); return; }
    handleError(res, err);
  }
});

router.put('/:id', async (req: Request, res: Response): Promise<void> => {
  try {
    const charId = String(req.params.id);
    if (!ownsCharacter(req.user!, charId)) { res.status(403).json({ message: 'No autorizado' }); return; }

    const existing = await Character.findById(charId);
    if (!existing) { res.status(404).json({ message: 'Character not found' }); return; }

    const { name, currentClass, resonance, armor, armorPenetration, power, resistance } = (req.body ?? {}) as Record<string, unknown>;
    const update: Record<string, unknown> = {};
    if (name             !== undefined) update.name             = String(name).trim();
    if (currentClass     !== undefined) update.currentClass     = currentClass;
    if (resonance        !== undefined) update.resonance        = Number(resonance) || 0;
    if (armor            !== undefined) update.armor            = Number(armor) || 0;
    if (armorPenetration !== undefined) update.armorPenetration = Number(armorPenetration) || 0;
    if (power            !== undefined) update.power            = Number(power) || 0;
    if (resistance       !== undefined) update.resistance       = Number(resistance) || 0;
    if (update.name !== undefined) {
      if (!update.name) { res.status(400).json({ message: 'Name is required' }); return; }
      const taken = await Character.findOne({ _id: { $ne: charId }, name: { $regex: `^${escapeRegex(update.name as string)}$`, $options: 'i' } }).select('_id');
      if (taken) { res.status(409).json({ message: 'Character name already taken' }); return; }
    }

    update.score = mergedScore(update, existing);

    const updated = await Character.findByIdAndUpdate(charId, update, { new: true });
    if (!updated) { res.status(404).json({ message: 'Character not found' }); return; }
    res.status(200).json(updated);
  } catch (err) {
    handleError(res, err);
  }
});

router.get('/:name', async (req: Request, res: Response): Promise<void> => {
  try {
    const q = String(req.params.name ?? '').trim();
    if (!q) { res.status(404).json({ found: false }); return; }
    const characters = await Character.find({ name: { $regex: escapeRegex(q), $options: 'i' } })
      .select(PUBLIC_CHAR_FIELDS).populate('clan', 'name status').limit(25).lean();
    if (characters.length > 0) {
      // Historial de clanes de cada resultado, para mostrarlo al agregar un
      // personaje al clan desde el buscador.
      const charIds = characters.map(c => c._id);
      const historyDocs = await ClanMembership.find({ character: { $in: charIds } })
        .sort({ joinedAt: -1 }).populate('clan', 'name').lean();
      const historyByChar = new Map<string, typeof historyDocs>();
      for (const h of historyDocs) {
        const key = String(h.character);
        if (!historyByChar.has(key)) historyByChar.set(key, []);
        historyByChar.get(key)!.push(h);
      }
      const withHistory = characters.map(c => ({
        ...c,
        clanHistory: (historyByChar.get(String(c._id)) ?? []).slice(0, 5),
      }));
      res.status(200).json({ found: true, characters: withHistory });
    } else {
      res.status(404).json({ found: false });
    }
  } catch (err) {
    handleError(res, err);
  }
});

export default router;
