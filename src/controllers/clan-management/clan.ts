import { Router, type Request, type Response } from 'express';
import Clan from '../../models/Clan';
import Character from '../../models/Character';
import User from '../../models/User';
import ClanInvitation from '../../models/ClanInvitation';
import { message } from '../../messages';
import type { IUser, IClan } from '../../types';

const router = Router();

const populateClan = (q: ReturnType<typeof Clan.findById>) =>
  q.populate('leader').populate('officer').populate('member');

function isSystemAdmin(user: IUser) { return user.role === 'admin' || user.role === 'super_admin'; }
function userCharIds(user: IUser)   { return user.character.map(String); }
function charIsLeader(clan: IClan, user: IUser)          { return isSystemAdmin(user) || userCharIds(user).includes(String(clan.leader)); }
function charIsOfficerOrLeader(clan: IClan, user: IUser) {
  return isSystemAdmin(user) || userCharIds(user).includes(String(clan.leader)) || clan.officer.some(o => userCharIds(user).includes(String(o)));
}

router.get('/:clanId', async (req: Request, res: Response): Promise<void> => {
  try {
    const clan = await populateClan(Clan.findById(req.params.clanId));
    if (!clan) { res.status(404).json({ message: 'Clan not found' }); return; }
    const pendingInvitations = await ClanInvitation.find({ clan: req.params.clanId, status: 'pending' })
      .populate('character', 'name currentClass resonance').populate('invitedByUser', 'battletag').sort({ createdAt: -1 });
    res.status(200).json({ ...(clan as unknown as { toObject(): Record<string, unknown> }).toObject(), pendingInvitations });
  } catch { res.status(500).json({ error: message.user.error }); }
});

router.post('/:clanId/members', async (req: Request, res: Response): Promise<void> => {
  try {
    const { characterId } = req.body as { characterId?: string };
    const clan = await Clan.findById(req.params.clanId);
    if (!clan) { res.status(404).json({ message: 'Clan not found' }); return; }
    if (!charIsOfficerOrLeader(clan, req.user!)) { res.status(403).json({ message: 'Se requiere ser líder u oficial del clan' }); return; }
    const char = await Character.findById(characterId);
    if (!char) { res.status(404).json({ message: 'Character not found' }); return; }
    const alreadyIn = [String(clan.leader), ...clan.officer.map(String), ...clan.member.map(String)].includes(String(characterId));
    if (!alreadyIn) { clan.member.push(char._id); char.clan = clan._id; await Promise.all([clan.save(), char.save()]); }
    res.status(200).json(await populateClan(Clan.findById(req.params.clanId)));
  } catch { res.status(500).json({ error: message.user.error }); }
});

router.delete('/:clanId/members/:characterId', async (req: Request, res: Response): Promise<void> => {
  try {
    const clanId = String(req.params.clanId); const characterId = String(req.params.characterId);
    const clan = await Clan.findById(clanId);
    if (!clan) { res.status(404).json({ message: 'Clan not found' }); return; }
    if (!charIsOfficerOrLeader(clan, req.user!)) { res.status(403).json({ message: 'Se requiere ser líder u oficial del clan' }); return; }
    if (String(clan.leader) === characterId) { res.status(400).json({ message: 'No se puede eliminar al líder del clan' }); return; }
    clan.member  = clan.member.filter(m => String(m) !== characterId);
    clan.officer = clan.officer.filter(o => String(o) !== characterId);
    await clan.save();
    await Character.findByIdAndUpdate(characterId, { $unset: { clan: '' } });
    try {
      const { getIO } = await import('../../socket');
      const owner = await User.findOne({ character: characterId }).select('_id');
      if (owner) getIO().to(`user:${String(owner._id)}`).emit('clan:member-removed', { clanName: clan.name, characterId });
    } catch (e) { console.warn('Socket notification failed:', (e as Error).message); }
    res.status(200).json(await populateClan(Clan.findById(clanId)));
  } catch { res.status(500).json({ error: message.user.error }); }
});

router.post('/:clanId/characters', async (req: Request, res: Response): Promise<void> => {
  try {
    const { name, resonance, currentClass } = req.body as { name?: string; resonance?: number; currentClass?: string };
    const clan = await Clan.findById(req.params.clanId);
    if (!clan) { res.status(404).json({ message: 'Clan not found' }); return; }
    if (!charIsOfficerOrLeader(clan, req.user!)) { res.status(403).json({ message: 'Se requiere ser líder u oficial del clan' }); return; }
    const char = await new Character({ name, resonance, currentClass, clan: req.params.clanId, status: 'unclaimed' }).save();
    clan.member.push(char._id); await clan.save();
    res.status(201).json(await populateClan(Clan.findById(req.params.clanId)));
  } catch { res.status(500).json({ error: message.user.error }); }
});

router.patch('/:clanId/members/:characterId', async (req: Request, res: Response): Promise<void> => {
  try {
    const clanId = String(req.params.clanId); const characterId = String(req.params.characterId);
    const { currentClass, resonance, memberStatus } = req.body as { currentClass?: string; resonance?: number; memberStatus?: string };
    const clan = await Clan.findById(clanId);
    if (!clan) { res.status(404).json({ message: 'Clan not found' }); return; }
    if (!charIsOfficerOrLeader(clan, req.user!)) { res.status(403).json({ message: 'Se requiere ser líder u oficial del clan' }); return; }
    const inClan = [String(clan.leader), ...clan.officer.map(String), ...clan.member.map(String)].includes(characterId);
    if (!inClan) { res.status(400).json({ message: 'El personaje no pertenece a este clan' }); return; }
    const update: Record<string, unknown> = {};
    if (currentClass !== undefined) update.currentClass = currentClass || null;
    if (resonance    !== undefined) update.resonance    = Number(resonance);
    if (memberStatus !== undefined) update.memberStatus = memberStatus;
    await Character.findByIdAndUpdate(characterId, update);
    res.status(200).json(await populateClan(Clan.findById(clanId)));
  } catch { res.status(500).json({ error: message.user.error }); }
});

router.patch('/:clanId/members/:characterId/role', async (req: Request, res: Response): Promise<void> => {
  try {
    const clanId = String(req.params.clanId); const characterId = String(req.params.characterId);
    const { role } = req.body as { role?: string };
    if (!role || !['officer', 'member'].includes(role)) { res.status(400).json({ message: 'Rol inválido. Use "officer" o "member"' }); return; }
    const clan = await Clan.findById(clanId);
    if (!clan) { res.status(404).json({ message: 'Clan not found' }); return; }
    if (!charIsLeader(clan, req.user!)) { res.status(403).json({ message: 'Solo el líder del clan puede cambiar roles' }); return; }
    if (String(clan.leader) === characterId) { res.status(400).json({ message: 'No se puede cambiar el rol del líder' }); return; }
    const inClan = clan.officer.map(String).includes(characterId) || clan.member.map(String).includes(characterId);
    if (!inClan) { res.status(404).json({ message: 'El personaje no pertenece a este clan' }); return; }
    clan.officer = clan.officer.filter(o => String(o) !== characterId);
    clan.member  = clan.member.filter(m => String(m) !== characterId);
    if (role === 'officer') clan.officer.push(characterId as unknown as typeof clan.officer[0]);
    else                    clan.member.push(characterId as unknown as typeof clan.member[0]);
    await clan.save();
    res.status(200).json(await populateClan(Clan.findById(clanId)));
  } catch { res.status(500).json({ error: message.user.error }); }
});

router.get('/:clanId/invitations', async (req: Request, res: Response): Promise<void> => {
  try {
    const clan = await Clan.findById(req.params.clanId);
    if (!clan) { res.status(404).json({ message: 'Clan not found' }); return; }
    if (!charIsOfficerOrLeader(clan, req.user!)) { res.status(403).json({ message: 'Se requiere ser líder u oficial del clan' }); return; }
    const invitations = await ClanInvitation.find({ clan: req.params.clanId, status: 'pending' })
      .populate('character', 'name currentClass resonance').populate('invitedByUser', 'battletag').sort({ createdAt: -1 });
    res.status(200).json(invitations);
  } catch { res.status(500).json({ error: message.user.error }); }
});

router.post('/:clanId/invitations', async (req: Request, res: Response): Promise<void> => {
  try {
    const { clanId } = req.params;
    const { characterId, role, proposedClass, proposedResonance } = req.body as { characterId?: string; role?: string; proposedClass?: string; proposedResonance?: number };
    const clan = await Clan.findById(clanId);
    if (!clan) { res.status(404).json({ message: 'Clan not found' }); return; }
    if (!charIsOfficerOrLeader(clan, req.user!)) { res.status(403).json({ message: 'Se requiere ser líder u oficial del clan' }); return; }
    const char = await Character.findById(characterId);
    if (!char) { res.status(404).json({ message: 'Personaje no encontrado' }); return; }
    if (char.status !== 'claimed') { res.status(400).json({ message: 'El personaje no está vinculado a un usuario' }); return; }
    const alreadyIn = [String(clan.leader), ...clan.officer.map(String), ...clan.member.map(String)].includes(String(characterId));
    if (alreadyIn) { res.status(409).json({ message: 'El personaje ya pertenece al clan' }); return; }
    const existing = await ClanInvitation.findOne({ clan: clanId, character: characterId, status: 'pending' });
    if (existing) { res.status(409).json({ message: 'Ya existe una invitación pendiente para este personaje' }); return; }
    const invitation = await ClanInvitation.create({
      clan: clanId, character: characterId, invitedByUser: req.user!._id,
      role: ['officer', 'member'].includes(role ?? '') ? role : 'member',
      proposedClass: proposedClass ?? null,
      proposedResonance: proposedResonance != null ? Number(proposedResonance) : null,
    });
    try {
      const { getIO } = await import('../../socket');
      const owner = await User.findOne({ character: characterId }).select('_id');
      if (owner) {
        const pop = await ClanInvitation.findById(invitation._id).populate('clan', 'name').populate('character', 'name');
        getIO().to(`user:${String(owner._id)}`).emit('clan-invitation:new', {
          id: String(pop!._id), clan: pop!.clan, character: pop!.character, role: pop!.role,
          proposedClass: pop!.proposedClass, proposedResonance: pop!.proposedResonance, createdAt: pop!.createdAt,
        });
      }
    } catch (e) { console.warn('Socket notification failed:', (e as Error).message); }
    res.status(201).json({ message: 'Invitación enviada' });
  } catch { res.status(500).json({ error: message.user.error }); }
});

router.delete('/:clanId/invitations/:invitationId', async (req: Request, res: Response): Promise<void> => {
  try {
    const clan = await Clan.findById(req.params.clanId);
    if (!clan) { res.status(404).json({ message: 'Clan not found' }); return; }
    if (!charIsOfficerOrLeader(clan, req.user!)) { res.status(403).json({ message: 'Se requiere ser líder u oficial del clan' }); return; }
    const inv = await ClanInvitation.findOneAndDelete({ _id: req.params.invitationId, clan: req.params.clanId, status: 'pending' });
    if (!inv) { res.status(404).json({ message: 'Invitación no encontrada' }); return; }
    res.status(200).json({ message: 'Invitación cancelada' });
  } catch { res.status(500).json({ error: message.user.error }); }
});

export default router;
