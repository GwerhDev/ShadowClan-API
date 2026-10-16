import { Router, type Request, type Response } from 'express';
import ClanRequest from '../models/ClanRequest';
import Clan from '../models/Clan';
import Character from '../models/Character';
import User from '../models/User';
import { message } from '../messages';
import { getUser } from '../helpers/getUser';
import { openMembership } from '../helpers/clanMembership';
import ClanMembership from '../models/ClanMembership';
import { isSystemAdmin, ownsCharacter, isLeaderOrOfficerOf, sameId } from '../helpers/clanScope';
import { handleError, parse } from '../helpers/http';
import * as V from '../validation/schemas';

const router = Router();

// POST / — send a clan join request
router.post('/', async (req: Request, res: Response): Promise<void> => {
  try {
    const user = await getUser(req);
    if (!user) { res.status(401).json({ message: message.user.unauthorized }); return; }

    const { characterId, clanId } = parse(V.clanRequestCreate, req.body);
    if (!ownsCharacter(user, characterId)) { res.status(403).json({ message: 'El personaje no te pertenece' }); return; }

    const [targetClan, reqChar] = await Promise.all([
      Clan.findById(clanId).select('_id'),
      Character.findById(characterId).select('clan'),
    ]);
    if (!targetClan) { res.status(404).json({ message: 'Clan no encontrado' }); return; }
    if (reqChar?.clan && sameId(reqChar.clan, clanId)) { res.status(409).json({ message: 'El personaje ya pertenece a este clan' }); return; }

    const existing = await ClanRequest.findOne({ character: characterId, clan: clanId, status: 'pending' });
    if (existing) { res.status(409).json({ message: 'Ya hay una solicitud pendiente para este clan' }); return; }

    const request = await ClanRequest.create({ user: user._id, character: characterId, clan: clanId });
    await request.populate('clan', 'name');
    await request.populate('character', 'name');

    try {
      const { getIO } = await import('../socket');
      const io = getIO();
      const clan = await Clan.findById(clanId);
      if (clan) {
        const privilegedCharIds = [clan.leader, ...(clan.officer ?? [])].filter(Boolean).map(String);

        if (clan.status === 'claimed' && privilegedCharIds.length > 0) {
          // Notify clan leaders/officers
          const targetUsers = await User.find({ character: { $in: privilegedCharIds } }).select('_id character');
          for (const u of targetUsers) {
            const targetCharId = u.character.find(c => privilegedCharIds.includes(String(c)));
            io.to(`user:${String(u._id)}`).emit('clan-request:new', {
              id: String(request._id), character: request.character,
              clan: request.clan, createdAt: request.createdAt,
              targetCharacterId: targetCharId ? String(targetCharId) : null,
            });
          }
        } else {
          // Clan unclaimed — notify admins via dashboard
          const admins = await User.find({ role: { $in: ['admin', 'super_admin'] } }).select('_id');
          for (const admin of admins) {
            io.to(`dashboard:${String(admin._id)}`).emit('admin:request:new', {
              type: 'clan-join-unclaimed',
              id: String(request._id),
              character: request.character,
              clan: request.clan,
              user: { battletag: user.battletag },
              createdAt: request.createdAt,
            });
          }
        }
      }
    } catch (e) {
      console.warn('Socket notification failed:', (e as Error).message);
    }

    res.status(201).json({ message: 'Solicitud enviada', request });
  } catch (err) {
    handleError(res, err);
  }
});

// GET /manage — pending requests for the active character's clan
router.get('/manage', async (req: Request, res: Response): Promise<void> => {
  try {
    const user = await getUser(req);
    if (!user) { res.status(401).json({ message: message.user.unauthorized }); return; }

    const charIds = user.character.map(String);
    const { characterId } = req.query as { characterId?: string };
    const activeCharId = characterId && charIds.includes(characterId) ? characterId : null;
    if (!activeCharId) { res.status(200).json([]); return; }

    const clan = await Clan.findOne({
      $or: [{ leader: activeCharId }, { officer: activeCharId }],
    }).select('_id');
    if (!clan) { res.status(200).json([]); return; }

    const requests = await ClanRequest.find({ clan: clan._id, status: 'pending' })
      .populate('user', 'battletag')
      .populate('character', 'name currentClass resonance')
      .populate('clan', 'name')
      .sort({ createdAt: -1 })
      .lean();

    // Historial de clanes de cada personaje solicitante, para que el líder/oficial
    // pueda ver por dónde ha pasado antes de aceptar o rechazar.
    const requestCharIds = requests.map(r => (r.character as { _id?: unknown } | null)?._id).filter(Boolean);
    const historyDocs = requestCharIds.length
      ? await ClanMembership.find({ character: { $in: requestCharIds } }).sort({ joinedAt: -1 }).populate('clan', 'name').lean()
      : [];
    const historyByChar = new Map<string, typeof historyDocs>();
    for (const h of historyDocs) {
      const key = String(h.character);
      if (!historyByChar.has(key)) historyByChar.set(key, []);
      historyByChar.get(key)!.push(h);
    }

    const withHistory = requests.map(r => ({
      ...r,
      character: r.character
        ? { ...r.character, clanHistory: (historyByChar.get(String((r.character as { _id?: unknown })._id)) ?? []).slice(0, 5) }
        : r.character,
    }));

    res.status(200).json(withHistory);
  } catch (err) {
    handleError(res, err);
  }
});

// DELETE /:id — cancel own pending request
router.delete('/:id', async (req: Request, res: Response): Promise<void> => {
  try {
    const user = await getUser(req);
    if (!user) { res.status(401).json({ message: message.user.unauthorized }); return; }

    const request = await ClanRequest.findOne({ _id: req.params.id, user: user._id, status: 'pending' })
      .populate('clan', 'name status leader officer');
    if (!request) { res.status(404).json({ message: 'Solicitud no encontrada' }); return; }

    await ClanRequest.findByIdAndDelete(request._id);

    // Notify the relevant parties to remove the pending notification
    try {
      const { getIO } = await import('../socket');
      const io = getIO();
      const clan = request.clan as unknown as { _id: unknown; name: string; status: string; leader?: unknown; officer?: unknown[] };

      if (clan.status === 'claimed') {
        const privilegedCharIds = [clan.leader, ...(clan.officer ?? [])].filter(Boolean).map(String);
        const targetUsers = await User.find({ character: { $in: privilegedCharIds } }).select('_id');
        for (const u of targetUsers) {
          io.to(`user:${String(u._id)}`).emit('clan-request:cancelled', { id: String(request._id) });
        }
      } else {
        const admins = await User.find({ role: { $in: ['admin', 'super_admin'] } }).select('_id');
        for (const admin of admins) {
          io.to(`dashboard:${String(admin._id)}`).emit('clan-request:cancelled', { id: String(request._id) });
        }
      }
    } catch (e) { console.warn('Socket cancel failed:', (e as Error).message); }

    res.status(200).json({ message: 'Solicitud cancelada.' });
  } catch (err) {
    handleError(res, err);
  }
});

// PATCH /:id — approve or reject
router.patch('/:id', async (req: Request, res: Response): Promise<void> => {
  try {
    const user = await getUser(req);
    if (!user) { res.status(401).json({ message: message.user.unauthorized }); return; }

    const { action, characterId } = req.body as { action?: string; characterId?: string };
    if (!action || !['accept', 'reject'].includes(action)) {
      res.status(400).json({ message: 'Acción inválida. Usa "accept" o "reject"' });
      return;
    }

    const request = await ClanRequest.findById(req.params.id);
    if (!request) { res.status(404).json({ message: 'Solicitud no encontrada' }); return; }
    if (request.status !== 'pending') { res.status(409).json({ message: 'La solicitud ya fue procesada' }); return; }

    const clan = await Clan.findById(request.clan);
    if (!clan) { res.status(404).json({ message: 'Clan no encontrado' }); return; }

    // El personaje activo (characterId) debe ser líder/oficial del clan de la solicitud.
    const isPrivileged = isSystemAdmin(user) ||
      (ownsCharacter(user, characterId) && await isLeaderOrOfficerOf(characterId, clan._id));
    if (!isPrivileged) { res.status(403).json({ message: message.admin.permissionDenied }); return; }

    if (action === 'accept') {
      const target = await Character.findById(request.character).select('clan');
      if (target?.clan && !sameId(target.clan, request.clan)) {
        res.status(409).json({ message: 'El personaje ya pertenece a otro clan' }); return;
      }
      await Clan.updateOne({ _id: request.clan }, { $addToSet: { member: request.character } });
      await Character.updateOne({ _id: request.character }, { clan: request.clan });
      await openMembership(request.character, request.clan, 'member');
      request.status = 'accepted';
    } else {
      request.status = 'rejected';
    }

    await request.save();

    const populated = await ClanRequest.findById(request._id)
      .populate('user', 'battletag')
      .populate('character', 'name currentClass resonance')
      .populate('clan', 'name');

    try {
      const { getIO } = await import('../socket');
      getIO().to(`user:${String(request.user)}`).emit('clan-request:reviewed', {
        id:        String(request._id),
        action,
        clan:      populated?.clan,
        character: populated?.character,
        createdAt: request.createdAt,
      });
    } catch (e) {
      console.warn('Socket notification failed:', (e as Error).message);
    }

    res.status(200).json({
      message: action === 'accept' ? 'Solicitud aceptada' : 'Solicitud rechazada',
      request: populated,
    });
  } catch (err) {
    handleError(res, err);
  }
});

// GET / — current user's own requests
router.get('/', async (req: Request, res: Response): Promise<void> => {
  try {
    const user = await getUser(req);
    if (!user) { res.status(401).json({ message: message.user.unauthorized }); return; }

    const requests = await ClanRequest.find({ user: user._id })
      .populate('clan', 'name')
      .populate('character', 'name')
      .sort({ createdAt: -1 });

    res.status(200).json(requests);
  } catch (err) {
    handleError(res, err);
  }
});

export default router;
