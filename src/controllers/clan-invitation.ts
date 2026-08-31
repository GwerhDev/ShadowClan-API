import { Router, type Request, type Response } from 'express';
import ClanInvitation from '../models/ClanInvitation';
import Clan from '../models/Clan';
import Character from '../models/Character';
import { message } from '../messages';
import { getUser } from '../helpers/getUser';
import { calcScore } from '../helpers/score';
import { openMembership, closeMembership } from '../helpers/clanMembership';

const router = Router();

// GET /character/:characterId — pending invitations for a character
router.get('/character/:characterId', async (req: Request, res: Response): Promise<void> => {
  try {
    const user = await getUser(req);
    if (!user) { res.status(401).json({ message: message.user.unauthorized }); return; }

    const charIds = user.character.map(String);
    if (!charIds.includes(String(req.params.characterId))) {
      res.status(403).json({ message: 'No tienes acceso a este personaje' });
      return;
    }

    const invitations = await ClanInvitation.find({
      character: String(req.params.characterId),
      status:    'pending',
    })
      .populate('clan', 'name')
      .populate('character', 'name currentClass resonance')
      .populate('invitedByUser', 'battletag')
      .sort({ createdAt: -1 });

    res.status(200).json(invitations);
  } catch {
    res.status(500).json({ error: message.user.error });
  }
});

// PATCH /:id — accept or reject invitation
router.patch('/:id', async (req: Request, res: Response): Promise<void> => {
  try {
    const user = await getUser(req);
    if (!user) { res.status(401).json({ message: message.user.unauthorized }); return; }

    const { action } = req.body as { action?: string };
    if (!action || !['accept', 'reject'].includes(action)) {
      res.status(400).json({ message: 'Acción inválida. Usa "accept" o "reject"' });
      return;
    }

    const invitation = await ClanInvitation.findById(req.params.id);
    if (!invitation) { res.status(404).json({ message: 'Invitación no encontrada' }); return; }
    if (invitation.status !== 'pending') { res.status(409).json({ message: 'La invitación ya fue procesada' }); return; }

    const charIds = user.character.map(String);
    if (!charIds.includes(String(invitation.character))) {
      res.status(403).json({ message: 'No tienes permiso para responder esta invitación' });
      return;
    }

    if (action === 'accept') {
      const clan = await Clan.findById(invitation.clan);
      if (!clan) { res.status(404).json({ message: 'Clan no encontrado' }); return; }

      const charIdStr = String(invitation.character);
      const alreadyIn = [String(clan.leader), ...clan.officer.map(String), ...clan.member.map(String)]
        .includes(charIdStr);

      if (!alreadyIn) {
        if (invitation.role === 'officer') {
          clan.officer.push(invitation.character);
        } else {
          clan.member.push(invitation.character);
        }
        await clan.save();
        await Character.findByIdAndUpdate(invitation.character, { clan: invitation.clan });
      }
      await openMembership(invitation.character, invitation.clan, invitation.role === 'officer' ? 'officer' : 'member');

      const charUpdate: Record<string, unknown> = {};
      if (invitation.proposedClass     != null) charUpdate.currentClass = invitation.proposedClass || null;
      if (invitation.proposedResonance != null) charUpdate.resonance    = invitation.proposedResonance;
      if (Object.keys(charUpdate).length) {
        const charDoc = await Character.findById(invitation.character);
        charUpdate.score = calcScore({
          resonance:        charUpdate.resonance        !== undefined ? Number(charUpdate.resonance)        : (charDoc?.resonance        ?? 0),
          armor:            charDoc?.armor            ?? 0,
          armorPenetration: charDoc?.armorPenetration ?? 0,
          power:            charDoc?.power            ?? 0,
          resistance:       charDoc?.resistance       ?? 0,
        });
        await Character.findByIdAndUpdate(invitation.character, charUpdate);
      }

      invitation.status = 'accepted';
    } else {
      const clan = await Clan.findById(invitation.clan);
      if (clan) {
        const charIdStr = String(invitation.character);
        clan.officer = clan.officer.filter(o => String(o) !== charIdStr);
        clan.member  = clan.member.filter(m => String(m) !== charIdStr);
        await clan.save();
        await Character.findByIdAndUpdate(invitation.character, { clan: null });
        // No-op si el personaje nunca llegó a tener un registro abierto (lo normal:
        // una invitación solo se crea cuando el personaje no está en el clan todavía).
        await closeMembership(invitation.character, invitation.clan, { backfill: false });
      }
      invitation.status = 'rejected';
    }

    await invitation.save();
    res.status(200).json({ message: action === 'accept' ? 'Invitación aceptada' : 'Invitación rechazada' });
  } catch (error) {
    console.error(error);
    res.status(500).json({ error: message.user.error });
  }
});

export default router;
