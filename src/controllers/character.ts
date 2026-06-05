import { Router, type Request, type Response } from 'express';
import User from '../models/User';
import Character from '../models/Character';
import { decodeToken } from '../integrations/jwt';
import { message } from '../messages';
import { characterConsts } from '../misc/consts-models';
import { calcScore } from '../helpers/score';

const router = Router();

router.get('/', async (req: Request, res: Response): Promise<void> => {
  try {
    const token = (req.cookies as Record<string, string>)['u_tkn']
      ?? req.headers.authorization?.split(' ')[1];
    const decoded = await decodeToken(token);
    const user = await User.findById(decoded.data.id)
      .populate('character')
      .populate({ path: 'character', populate: { path: 'clan' } });
    if (!user) { res.status(404).json({ logged: false, message: message.user.notfound }); return; }
    res.status(200).json(user.character);
  } catch {
    res.status(500).json({ error: message.user.error });
  }
});

router.post('/create', async (req: Request, res: Response): Promise<void> => {
  try {
    const token = (req.cookies as Record<string, string>)['u_tkn']
      ?? req.headers.authorization?.split(' ')[1];
    if (!token) { res.status(401).json({ error: 'Missing token' }); return; }

    let decoded;
    try { decoded = await decodeToken(token); } catch { res.status(401).json({ error: 'Invalid token' }); return; }

    const user = await User.findById(decoded.data.id);
    if (!user) { res.status(404).json({ logged: false, message: message.user.notfound }); return; }

    const { name, currentClass, resonance, clan } = (req.body ?? {}) as Record<string, string | undefined>;
    if (!name) { res.status(400).json({ error: 'Name is required' }); return; }

    const exists = await Character.findOne({ name });
    if (exists?.status === characterConsts.status.claimed || exists?.status === characterConsts.status.pending) {
      res.status(409).json({ error: 'Character already claimed' }); return;
    }
    if (exists?.status === characterConsts.status.unclaimed) {
      res.status(409).json({ error: 'Character already exists, but not claimed', characterId: exists._id }); return;
    }

    const newChar = await Character.create({ name, currentClass, resonance, clan, status: characterConsts.status.claimed });
    await User.updateOne({ _id: user._id }, { $push: { character: newChar._id } });
    const updatedUser = await User.findById(user._id).populate('character');

    res.status(201).json({ message: message.character.create.success, character: newChar, user: updatedUser });
  } catch (error) {
    const e = error as { code?: number };
    if (e.code === 11000) { res.status(409).json({ error: 'Character name already taken' }); return; }
    console.error(error);
    res.status(500).json({ error: message.user.error });
  }
});

router.put('/:id', async (req: Request, res: Response): Promise<void> => {
  try {
    const token = (req.cookies as Record<string, string>)['u_tkn']
      ?? req.headers.authorization?.split(' ')[1];
    const decoded = await decodeToken(token);
    const user = await User.findById(decoded.data.id);
    if (!user) { res.status(404).json({ message: message.user.notfound }); return; }

    const charId = req.params.id;
    if (!user.character.some(c => String(c) === charId)) { res.status(403).json({ error: 'No autorizado' }); return; }

    const existing = await Character.findById(charId);
    if (!existing) { res.status(404).json({ error: 'Character not found' }); return; }

    const { name, currentClass, resonance, armor, armorPenetration, power, resistance } = (req.body ?? {}) as Record<string, unknown>;
    const update: Record<string, unknown> = {};
    if (name             !== undefined) update.name             = name;
    if (currentClass     !== undefined) update.currentClass     = currentClass;
    if (resonance        !== undefined) update.resonance        = resonance;
    if (armor            !== undefined) update.armor            = armor;
    if (armorPenetration !== undefined) update.armorPenetration = armorPenetration;
    if (power            !== undefined) update.power            = power;
    if (resistance       !== undefined) update.resistance       = resistance;

    update.score = calcScore({
      resonance:        resonance        !== undefined ? Number(resonance)        : (existing.resonance        ?? 0),
      armor:            armor            !== undefined ? Number(armor)            : (existing.armor            ?? 0),
      armorPenetration: armorPenetration !== undefined ? Number(armorPenetration) : (existing.armorPenetration ?? 0),
      power:            power            !== undefined ? Number(power)            : (existing.power            ?? 0),
      resistance:       resistance       !== undefined ? Number(resistance)       : (existing.resistance       ?? 0),
    });

    const updated = await Character.findByIdAndUpdate(charId, update, { new: true });
    if (!updated) { res.status(404).json({ error: 'Character not found' }); return; }
    res.status(200).json(updated);
  } catch {
    res.status(500).json({ error: message.user.error });
  }
});

router.get('/:name', async (req: Request, res: Response): Promise<void> => {
  try {
    const characters = await Character.find({ name: { $regex: req.params.name, $options: 'i' } }).populate('clan');
    if (characters.length > 0) {
      res.status(200).json({ found: true, characters });
    } else {
      res.status(404).json({ found: false });
    }
  } catch {
    res.status(500).json({ error: message.user.error });
  }
});

export default router;
