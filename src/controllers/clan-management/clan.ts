import { Router, type Request, type Response } from 'express';
import multer from 'multer';
import { Types } from 'mongoose';
import Clan from '../../models/Clan';
import Character from '../../models/Character';
import User from '../../models/User';
import ClanInvitation from '../../models/ClanInvitation';
import { message } from '../../messages';
import type { IClan } from '../../types';
import { isSystemAdmin, ownsCharacter, sameId, escapeRegex } from '../../helpers/clanScope';
import { mergedScore } from '../../helpers/score';
import { openMembership, closeMembership, updateOpenRole } from '../../helpers/clanMembership';
import { parseRosterFile, RosterFormatError, findWarsByDate, datesWithoutWar, upsertAttendance } from '../../helpers/rosterImport';
import { previewRosterSync, applyRosterSync, SyncResolutionError, type SyncResolutions } from '../../helpers/rosterSync';
import { badRequest } from '../../helpers/http';
import ClanMembership from '../../models/ClanMembership';
import { handleError, parse } from '../../helpers/http';
import * as V from '../../validation/schemas';

const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 10 * 1024 * 1024 } });

const router = Router();

/** Lee el archivo subido; errores de formato → 400 con mensaje claro. */
function parseUploadedRoster(file: Express.Multer.File | undefined) {
  if (!file) throw badRequest('No se recibió ningún archivo.');
  try {
    return parseRosterFile(file.buffer);
  } catch (e) {
    if (e instanceof RosterFormatError) throw badRequest(e.message);
    throw badRequest('No se pudo leer el archivo. Verifica que sea un .xlsx o .csv válido.');
  }
}

/** `resolutions` llega como JSON en el multipart: { "<nombre en minúsculas>": { action, characterId? } }. */
function parseResolutions(raw: unknown): SyncResolutions {
  if (!raw) return {};
  try {
    const obj = typeof raw === 'string' ? JSON.parse(raw) : raw;
    const out: SyncResolutions = {};
    for (const [name, r] of Object.entries(obj as Record<string, any>)) {
      if (r?.action === 'replace' && typeof r.characterId === 'string') out[name.trim().toLowerCase()] = { action: 'replace', characterId: r.characterId };
      else out[name.trim().toLowerCase()] = { action: 'create' };
    }
    return out;
  } catch { throw badRequest('Formato de decisiones inválido.'); }
}

const populateClan = (q: ReturnType<typeof Clan.findById>) =>
  q.populate('leader').populate('officer').populate('member');

// El personaje activo (actor) viaja siempre como ?characterId= en estas rutas, porque
// en varias el `characterId` del body/params es el personaje OBJETIVO de la acción.
// Los permisos se evalúan sobre ese personaje, nunca sobre "cualquiera" de la cuenta.
function actorId(req: Request): string | undefined {
  const v = req.query.characterId;
  return typeof v === 'string' && v ? v : undefined;
}
function actorOwned(req: Request): string | null {
  const id = actorId(req);
  return id && ownsCharacter(req.user!, id) ? id : null;
}
function charIsLeader(clan: IClan, req: Request): boolean {
  if (isSystemAdmin(req.user!)) return true;
  const id = actorOwned(req);
  return !!id && sameId(clan.leader, id);
}
function charIsOfficerOrLeader(clan: IClan, req: Request): boolean {
  if (isSystemAdmin(req.user!)) return true;
  const id = actorOwned(req);
  return !!id && (sameId(clan.leader, id) || clan.officer.some(o => sameId(o, id)));
}
function charIsMember(clan: IClan, req: Request): boolean {
  if (isSystemAdmin(req.user!)) return true;
  const id = actorOwned(req);
  return !!id && (sameId(clan.leader, id) || clan.officer.some(o => sameId(o, id)) || clan.member.some(m => sameId(m, id)));
}

router.get('/:clanId', async (req: Request, res: Response): Promise<void> => {
  try {
    const clan = await populateClan(Clan.findById(req.params.clanId));
    if (!clan) { res.status(404).json({ message: 'Clan not found' }); return; }
    // Solo miembros del clan (o admins) ven la plantilla; las invitaciones solo líder/oficial.
    if (!charIsMember(clan as unknown as IClan, req)) { res.status(403).json({ message: message.admin.permissionDenied }); return; }
    const pendingInvitations = charIsOfficerOrLeader(clan as unknown as IClan, req)
      ? await ClanInvitation.find({ clan: req.params.clanId, status: 'pending' })
          .populate('character', 'name currentClass resonance').populate('invitedByUser', 'battletag').sort({ createdAt: -1 })
      : [];
    res.status(200).json({ ...(clan as unknown as { toObject(): Record<string, unknown> }).toObject(), pendingInvitations });
  } catch (err) { handleError(res, err); }
});

router.post('/:clanId/members', async (req: Request, res: Response): Promise<void> => {
  try {
    const { characterId } = req.body as { characterId?: string };
    const clan = await Clan.findById(req.params.clanId);
    if (!clan) { res.status(404).json({ message: 'Clan not found' }); return; }
    if (!charIsOfficerOrLeader(clan, req)) { res.status(403).json({ message: 'Se requiere ser líder u oficial del clan' }); return; }
    const char = await Character.findById(characterId);
    if (!char) { res.status(404).json({ message: 'Character not found' }); return; }
    if (char.clan && !sameId(char.clan, clan._id)) { res.status(409).json({ message: 'El personaje ya pertenece a otro clan' }); return; }
    const alreadyIn =[String(clan.leader), ...clan.officer.map(String), ...clan.member.map(String)].includes(String(characterId));
    if (!alreadyIn) { clan.member.push(char._id); char.clan = clan._id; await Promise.all([clan.save(), char.save()]); }
    await openMembership(char._id, clan._id, 'member');
    res.status(200).json(await populateClan(Clan.findById(req.params.clanId)));
  } catch (err) { handleError(res, err); }
});

// Self-leave clan
router.post('/:clanId/leave', async (req: Request, res: Response): Promise<void> => {
  try {
    const clanId = String(req.params.clanId);
    const { characterId } = req.body as { characterId?: string };
    if (!characterId) { res.status(400).json({ message: 'Se requiere characterId' }); return; }

    const charIds = req.user!.character.map(String);
    if (!charIds.includes(characterId)) { res.status(403).json({ message: 'No autorizado' }); return; }

    const clan = await Clan.findById(clanId);
    if (!clan) { res.status(404).json({ message: 'Clan not found' }); return; }
    const isLeader = String(clan.leader) === characterId;
    const totalMembers = (clan.leader ? 1 : 0) + clan.officer.length + clan.member.length;

    if (isLeader) {
      // Only member → leave and set clan unclaimed
      if (totalMembers === 1) {
        clan.leader = undefined;
        clan.status = 'unclaimed' as typeof clan.status;
        await clan.save();
        await Character.findByIdAndUpdate(characterId, { $unset: { clan: '' } });
        await closeMembership(characterId, clanId);
        res.status(200).json({ message: 'Has abandonado el clan. El clan queda sin reclamar.' }); return;
      }
      res.status(400).json({ message: 'El líder no puede abandonar el clan mientras haya otros miembros. Transfiere el liderazgo primero.' }); return;
    }

    clan.officer = clan.officer.filter(o => String(o) !== characterId);
    clan.member  = clan.member.filter(m => String(m) !== characterId);
    await clan.save();
    await Character.findByIdAndUpdate(characterId, { $unset: { clan: '' } });
    await closeMembership(characterId, clanId);

    res.status(200).json({ message: 'Has abandonado el clan.' });
  } catch (err) { handleError(res, err); }
});

router.delete('/:clanId/members/:characterId', async (req: Request, res: Response): Promise<void> => {
  try {
    const clanId = String(req.params.clanId); const characterId = String(req.params.characterId);
    const { reason } = req.body as { reason?: string };
    const clan = await Clan.findById(clanId);
    if (!clan) { res.status(404).json({ message: 'Clan not found' }); return; }
    if (!charIsOfficerOrLeader(clan, req)) { res.status(403).json({ message: 'Se requiere ser líder u oficial del clan' }); return; }
    if (String(clan.leader) === characterId) { res.status(400).json({ message: 'No se puede eliminar al líder del clan' }); return; }
    const targetIsOfficer = clan.officer.some(o => String(o) === characterId);
    if (targetIsOfficer && !charIsLeader(clan, req)) { res.status(403).json({ message: 'Solo el líder puede eliminar oficiales' }); return; }
    clan.member  = clan.member.filter(m => String(m) !== characterId);
    clan.officer = clan.officer.filter(o => String(o) !== characterId);
    await clan.save();
    await Character.findByIdAndUpdate(characterId, { $unset: { clan: '' } });
    await closeMembership(characterId, clanId, {
      expulsionReason: reason?.trim() || undefined,
      removedBy: req.user!._id,
      role: targetIsOfficer ? 'officer' : 'member',
    });
    try {
      const { getIO } = await import('../../socket');
      const owner = await User.findOne({ character: characterId }).select('_id');
      if (owner) getIO().to(`user:${String(owner._id)}`).emit('clan:member-removed', { clanName: clan.name, characterId });
    } catch (e) { console.warn('Socket notification failed:', (e as Error).message); }
    res.status(200).json(await populateClan(Clan.findById(clanId)));
  } catch (err) { handleError(res, err); }
});

router.post('/:clanId/characters', async (req: Request, res: Response): Promise<void> => {
  try {
    const { name, resonance, currentClass } = parse(V.clanCharacterCreate, req.body);
    const clan = await Clan.findById(req.params.clanId);
    if (!clan) { res.status(404).json({ message: 'Clan not found' }); return; }
    if (!charIsOfficerOrLeader(clan, req)) { res.status(403).json({ message: 'Se requiere ser líder u oficial del clan' }); return; }
    const char = await new Character({ name, resonance, currentClass, clan: req.params.clanId, status: 'unclaimed' }).save();
    clan.member.push(char._id); await clan.save();
    await openMembership(char._id, clan._id, 'member');
    res.status(201).json(await populateClan(Clan.findById(req.params.clanId)));
  } catch (err) { handleError(res, err); }
});

router.patch('/:clanId/members/:characterId', async (req: Request, res: Response): Promise<void> => {
  try {
    const clanId = String(req.params.clanId); const characterId = String(req.params.characterId);
    const { currentClass, resonance, memberStatus, armor, armorPenetration, power, resistance } = parse(V.memberPatch, req.body);
    const clan = await Clan.findById(clanId);
    if (!clan) { res.status(404).json({ message: 'Clan not found' }); return; }
    if (!charIsOfficerOrLeader(clan, req)) { res.status(403).json({ message: 'Se requiere ser líder u oficial del clan' }); return; }
    const inClan = [String(clan.leader), ...clan.officer.map(String), ...clan.member.map(String)].includes(characterId);
    if (!inClan) { res.status(400).json({ message: 'El personaje no pertenece a este clan' }); return; }
    const existing = await Character.findById(characterId);
    const update: Record<string, unknown> = {};
    if (currentClass     !== undefined) update.currentClass     = currentClass || null;
    if (resonance        !== undefined) update.resonance        = Number(resonance);
    if (memberStatus     !== undefined) update.memberStatus     = memberStatus;
    if (armor            !== undefined) update.armor            = Number(armor);
    if (armorPenetration !== undefined) update.armorPenetration = Number(armorPenetration);
    if (power            !== undefined) update.power            = Number(power);
    if (resistance       !== undefined) update.resistance       = Number(resistance);
    update.score = mergedScore(update, existing);
    await Character.findByIdAndUpdate(characterId, update);
    res.status(200).json(await populateClan(Clan.findById(clanId)));
  } catch (err) { handleError(res, err); }
});

router.patch('/:clanId/members/:characterId/role', async (req: Request, res: Response): Promise<void> => {
  try {
    const clanId = String(req.params.clanId); const characterId = String(req.params.characterId);
    const { role } = req.body as { role?: string };
    if (!role || !['officer', 'member'].includes(role)) { res.status(400).json({ message: 'Rol inválido. Use "officer" o "member"' }); return; }
    const clan = await Clan.findById(clanId);
    if (!clan) { res.status(404).json({ message: 'Clan not found' }); return; }
    if (!charIsLeader(clan, req)) { res.status(403).json({ message: 'Solo el líder del clan puede cambiar roles' }); return; }
    if (String(clan.leader) === characterId) { res.status(400).json({ message: 'No se puede cambiar el rol del líder' }); return; }
    const inClan = clan.officer.map(String).includes(characterId) || clan.member.map(String).includes(characterId);
    if (!inClan) { res.status(404).json({ message: 'El personaje no pertenece a este clan' }); return; }
    clan.officer = clan.officer.filter(o => String(o) !== characterId);
    clan.member  = clan.member.filter(m => String(m) !== characterId);
    if (role === 'officer') clan.officer.push(characterId as unknown as typeof clan.officer[0]);
    else                    clan.member.push(characterId as unknown as typeof clan.member[0]);
    await clan.save();
    await updateOpenRole(characterId, clanId, role as 'officer' | 'member');
    res.status(200).json(await populateClan(Clan.findById(clanId)));
  } catch (err) { handleError(res, err); }
});

router.get('/:clanId/invitations', async (req: Request, res: Response): Promise<void> => {
  try {
    const clan = await Clan.findById(req.params.clanId);
    if (!clan) { res.status(404).json({ message: 'Clan not found' }); return; }
    if (!charIsOfficerOrLeader(clan, req)) { res.status(403).json({ message: 'Se requiere ser líder u oficial del clan' }); return; }
    const invitations = await ClanInvitation.find({ clan: req.params.clanId, status: 'pending' })
      .populate('character', 'name currentClass resonance').populate('invitedByUser', 'battletag').sort({ createdAt: -1 });
    res.status(200).json(invitations);
  } catch (err) { handleError(res, err); }
});

router.post('/:clanId/invitations', async (req: Request, res: Response): Promise<void> => {
  try {
    const { clanId } = req.params;
    const { characterId, role, proposedClass, proposedResonance } = parse(V.invitationCreate, req.body);
    const clan = await Clan.findById(clanId);
    if (!clan) { res.status(404).json({ message: 'Clan not found' }); return; }
    if (!charIsOfficerOrLeader(clan, req)) { res.status(403).json({ message: 'Se requiere ser líder u oficial del clan' }); return; }
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
  } catch (err) { handleError(res, err); }
});

router.delete('/:clanId/invitations/:invitationId', async (req: Request, res: Response): Promise<void> => {
  try {
    const clan = await Clan.findById(req.params.clanId);
    if (!clan) { res.status(404).json({ message: 'Clan not found' }); return; }
    if (!charIsOfficerOrLeader(clan, req)) { res.status(403).json({ message: 'Se requiere ser líder u oficial del clan' }); return; }
    const inv = await ClanInvitation.findOneAndDelete({ _id: req.params.invitationId, clan: req.params.clanId, status: 'pending' });
    if (!inv) { res.status(404).json({ message: 'Invitación no encontrada' }); return; }
    res.status(200).json({ message: 'Invitación cancelada' });
  } catch (err) { handleError(res, err); }
});

// ── Paginated members list ────────────────────────────────────────────────────
// status: 'active' (solo miembros actuales) | 'ex' (solo exmiembros) | 'all' (default,
// activos primero y exmiembros al final). Los datos de exmiembros (motivo, quién lo
// sacó) solo se incluyen si quien pregunta es líder/oficial — si no, 'all' degrada a
// solo activos en silencio (no rompe la vista para un miembro común) y 'ex' devuelve 403.
router.get('/:clanId/members', async (req: Request, res: Response): Promise<void> => {
  try {
    const clan = await Clan.findById(req.params.clanId).select('leader officer member');
    if (!clan) { res.status(404).json({ message: 'Clan not found' }); return; }

    const { q, page: rawPage, limit: rawLimit, status: rawStatus } = req.query as Record<string, string>;
    const page   = Math.max(1, parseInt(rawPage  ?? '1',  10));
    const limit  = Math.min(50, Math.max(1, parseInt(rawLimit ?? '20', 10)));
    const status = (['active', 'ex', 'all'].includes(rawStatus) ? rawStatus : 'all') as 'active' | 'ex' | 'all';

    if (!charIsMember(clan, req)) { res.status(403).json({ message: message.admin.permissionDenied }); return; }
    const canSeeExMembers = charIsOfficerOrLeader(clan, req);
    if (status === 'ex' && !canSeeExMembers) { res.status(403).json({ message: 'Se requiere ser líder u oficial del clan' }); return; }
    const wantsEx = status === 'ex' || (status === 'all' && canSeeExMembers);

    let activeRows: Array<Record<string, unknown>> = [];
    if (status !== 'ex') {
      // Build ordered role map: leader → officer → member
      const roleOrder: Record<string, number> = {};
      const roleLabel: Record<string, 'leader' | 'officer' | 'member'> = {};
      if (clan.leader) { const k = String(clan.leader); roleOrder[k] = 0; roleLabel[k] = 'leader'; }
      for (const o of clan.officer ?? []) { const k = String(o); roleOrder[k] = 1; roleLabel[k] = 'officer'; }
      for (const m of clan.member  ?? []) { const k = String(m); roleOrder[k] = 2; roleLabel[k] = 'member'; }
      const allIds = Object.keys(roleLabel);

      const filter: Record<string, unknown> = { _id: { $in: allIds } };
      if (q?.trim()) filter.name = { $regex: escapeRegex(q.trim()), $options: 'i' };

      const chars = await Character.find(filter).select('name currentClass resonance memberStatus status armor armorPenetration power resistance score').lean();
      chars.sort((a, b) => {
        const ra = roleOrder[String(a._id)] ?? 2;
        const rb = roleOrder[String(b._id)] ?? 2;
        return ra !== rb ? ra - rb : a.name.localeCompare(b.name);
      });
      activeRows = chars.map(c => ({ ...c, role: roleLabel[String(c._id)] ?? 'member', isExMember: false }));
    }

    let exRows: Array<Record<string, unknown>> = [];
    if (wantsEx) {
      const exDocs = await ClanMembership.find({ clan: clan._id, leftAt: { $ne: null } })
        .sort({ leftAt: -1 })
        .populate('character', 'name currentClass resonance memberStatus status armor armorPenetration power resistance score')
        .lean();
      const qLower = q?.trim().toLowerCase();
      exRows = exDocs
        .filter(d => d.character && (!qLower || (d.character as unknown as { name?: string }).name?.toLowerCase().includes(qLower)))
        .map(d => ({
          ...(d.character as object),
          role: d.role,
          isExMember: true,
          leftAt: d.leftAt,
          expulsionReason: d.expulsionReason,
        }));
    }

    const combined = status === 'ex' ? exRows : status === 'active' ? activeRows : [...activeRows, ...exRows];
    const total  = combined.length;
    const sliced = combined.slice((page - 1) * limit, page * limit);

    res.status(200).json({ total, page, limit, hasMore: page * limit < total, members: sliced });
  } catch (err) { handleError(res, err); }
});

// ── Bulk import from CSV / XLSX ───────────────────────────────────────────────
router.post('/:clanId/bulk-import', upload.single('file'), async (req: Request, res: Response): Promise<void> => {
  try {
    if (!req.file) { res.status(400).json({ message: 'No se recibió ningún archivo.' }); return; }

    const clan = await Clan.findById(req.params.clanId);
    if (!clan) { res.status(404).json({ message: 'Clan not found' }); return; }
    if (!charIsOfficerOrLeader(clan, req)) { res.status(403).json({ message: 'Se requiere ser líder u oficial del clan' }); return; }

    const parsed = parseUploadedRoster(req.file);

    type ImportResult = { name: string; status: 'created' | 'updated' | 'invited' | 'skipped'; reason?: string };
    const results: ImportResult[] = [];
    const wars = await findWarsByDate(parsed.dateColumns.map(d => d.date), clan._id);

    for (const parsedRow of parsed.rows) {
      const rawName = parsedRow.name;
      const data = parsedRow.data as { currentClass?: string; resonance?: number };
      // Solo los campos presentes (no pisa valores existentes con vacíos).
      const update: Record<string, unknown> = { ...parsedRow.data };

      // Find existing character by name (case-insensitive)
      const existing = await Character.findOne({ name: { $regex: `^${escapeRegex(rawName)}$`, $options: 'i' } });

      if (!existing) {
        // Create new unclaimed character and add to clan
        update.score = mergedScore(update);
        const char = await new Character({ name: rawName, ...update, status: 'unclaimed' }).save();
        clan.member.push(char._id as Types.ObjectId);
        await clan.save();
        await openMembership(char._id, clan._id, 'member');
        await upsertAttendance(parsedRow.attendedDates, char._id, clan._id, wars);
        results.push({ name: rawName, status: 'created' });
        continue;
      }

      const existingClanStr  = existing.clan ? String(existing.clan) : null;
      const targetClanStr    = String(clan._id);
      const inThisClan       = existingClanStr === targetClanStr;
      const inAnotherClan    = existingClanStr !== null && !inThisClan;

      if (inAnotherClan) {
        // Character belongs to a different clan → send invitation instead of forcing move
        const alreadyInvited = await ClanInvitation.findOne({ clan: clan._id, character: existing._id, status: 'pending' });
        if (!alreadyInvited) {
          await ClanInvitation.create({
            clan:              clan._id,
            character:         existing._id,
            invitedByUser:     req.user!._id,
            role:              'member',
            proposedClass:     data.currentClass ?? null,
            proposedResonance: data.resonance ?? null,
          });
          // Notify character owner
          try {
            const { getIO } = await import('../../socket');
            const owner = await User.findOne({ character: existing._id }).select('_id');
            if (owner) {
              const pop = await ClanInvitation.findOne({ clan: clan._id, character: existing._id, status: 'pending' })
                .populate('clan', 'name').populate('character', 'name');
              if (pop) getIO().to(`user:${String(owner._id)}`).emit('clan-invitation:new', {
                id: String(pop._id), clan: pop.clan, character: pop.character,
                role: pop.role, proposedClass: pop.proposedClass, proposedResonance: pop.proposedResonance,
                createdAt: pop.createdAt,
              });
            }
          } catch { /* socket failure never breaks the response */ }
        }
        results.push({ name: rawName, status: 'invited', reason: 'Pertenece a otro clan. Se envió invitación.' });
        continue;
      }

      // Character is unclaimed or in this clan → update stats
      update.score = mergedScore(update, existing);
      await Character.findByIdAndUpdate(existing._id, update);
      await upsertAttendance(parsedRow.attendedDates, existing._id, clan._id, wars);

      // Add to clan if not already a member
      if (!inThisClan) {
        const alreadyIn = [String(clan.leader), ...clan.officer.map(String), ...clan.member.map(String)].includes(String(existing._id));
        if (!alreadyIn) { clan.member.push(existing._id as Types.ObjectId); await clan.save(); }
      }
      await openMembership(existing._id, clan._id, 'member');

      // Notify owner if claimed
      if (existing.status === 'claimed') {
        try {
          const { getIO } = await import('../../socket');
          const owner = await User.findOne({ character: existing._id }).select('_id');
          if (owner) getIO().to(`user:${String(owner._id)}`).emit('character:stats-updated', {
            characterId: String(existing._id),
            characterName: existing.name,
            updates: update,
          });
        } catch { /* socket failure never breaks the response */ }
      }

      results.push({ name: rawName, status: 'updated' });
    }

    res.status(200).json({ processed: results.length, results, warnings: { ...parsed.warnings, datesWithoutWar: datesWithoutWar(parsed, wars) } });
  } catch (err) {
    handleError(res, err);
  }
});

// ── Sync (overwrite) clan members from CSV / XLSX ────────────────────────────
// ── Sincronizar plantilla desde planilla (reemplaza member[]) ────────────────
// Paso 1: vista previa (no escribe): resumen, personajes nuevos y candidatos a reemplazar.
router.post('/:clanId/sync/preview', upload.single('file'), async (req: Request, res: Response): Promise<void> => {
  try {
    const clan = await Clan.findById(req.params.clanId);
    if (!clan) { res.status(404).json({ message: 'Clan not found' }); return; }
    if (!charIsOfficerOrLeader(clan, req)) { res.status(403).json({ message: 'Se requiere ser líder u oficial del clan' }); return; }
    const parsed = parseUploadedRoster(req.file);
    res.status(200).json(await previewRosterSync(clan, parsed));
  } catch (err) { handleError(res, err); }
});

// Paso 2: aplica la sincronización con las decisiones para cada personaje nuevo
// (crear o reemplazar a un miembro saliente / exmiembro, conservando su historial).
router.post('/:clanId/sync', upload.single('file'), async (req: Request, res: Response): Promise<void> => {
  try {
    const clan = await Clan.findById(req.params.clanId);
    if (!clan) { res.status(404).json({ message: 'Clan not found' }); return; }
    if (!charIsOfficerOrLeader(clan, req)) { res.status(403).json({ message: 'Se requiere ser líder u oficial del clan' }); return; }
    const parsed = parseUploadedRoster(req.file);
    const resolutions = parseResolutions((req.body as Record<string, unknown>)?.resolutions);
    try {
      res.status(200).json(await applyRosterSync(clan, parsed, resolutions, req.user!._id));
    } catch (e) {
      if (e instanceof SyncResolutionError) throw badRequest(e.message);
      throw e;
    }
  } catch (err) { handleError(res, err); }
});

router.patch('/:clanId/saved-roster', async (req: Request, res: Response): Promise<void> => {
  try {
    const clan = await Clan.findById(req.params.clanId);
    if (!clan) { res.status(404).json({ message: 'Clan not found' }); return; }
    if (!charIsOfficerOrLeader(clan, req)) { res.status(403).json({ message: 'Se requiere ser líder u oficial del clan' }); return; }

    const { type, slot, data, name, customIndex, action } =
      req.body as { type?: string; slot?: string; data?: any; name?: string; customIndex?: number | null; action?: string };

    const field = type === 'accursed-tower' ? 'savedAccursedTowerAlignments'
                : type === 'shadow-war'     ? 'savedShadowWarAlignments'
                : null;
    if (!field) { res.status(400).json({ message: 'Tipo inválido.' }); return; }

    const current: { last?: any; custom?: any[] } = (clan as any)[field] ?? { last: null, custom: [] };
    if (!current.custom) current.custom = [];

    if (slot === 'last') {
      current.last = data ?? null;
    } else if (slot === 'custom') {
      if (action === 'delete') {
        if (typeof customIndex === 'number' && customIndex >= 0 && customIndex < current.custom.length) {
          current.custom.splice(customIndex, 1);
        }
      } else {
        if (current.custom.length >= 3 && (customIndex == null)) {
          res.status(400).json({ message: 'Máximo 3 plantillas. Indica cuál reemplazar.' }); return;
        }
        const entry = { name: String(name ?? '').trim(), data, savedAt: new Date() };
        if (typeof customIndex === 'number' && customIndex >= 0) current.custom[customIndex] = entry;
        else current.custom.push(entry);
      }
    } else {
      res.status(400).json({ message: 'Slot inválido. Use "last" o "custom".' }); return;
    }

    await Clan.findByIdAndUpdate(req.params.clanId, { [field]: current });
    res.status(200).json({ message: 'Alineación guardada' });
  } catch (err) { handleError(res, err); }
});

router.post('/:clanId/auto-assign', async (req: Request, res: Response): Promise<void> => {
  try {
    const clan = await Clan.findById(req.params.clanId).select('leader officer member');
    if (!clan) { res.status(404).json({ message: 'Clan not found' }); return; }
    if (!charIsOfficerOrLeader(clan, req)) {
      res.status(403).json({ message: 'Se requiere ser líder u oficial del clan' }); return;
    }

    const { type, formation } = req.body as { type?: string; formation?: any };
    if (type !== 'accursed-tower' && type !== 'shadow-war') {
      res.status(400).json({ message: 'Tipo inválido. Use "accursed-tower" o "shadow-war"' }); return;
    }

    const allIds = [
      ...(clan.leader ? [String(clan.leader)] : []),
      ...clan.officer.map(String),
      ...clan.member.map(String),
    ];
    const members = await Character.find({
      _id: { $in: allIds },
      memberStatus: { $nin: ['inactivo', 'retirado'] },
    }).select('_id currentClass score').lean();

    const { autoAssignAT, autoAssignSW } = await import('../../helpers/autoAssign');
    const result = type === 'accursed-tower'
      ? autoAssignAT(members)
      : autoAssignSW(members, formation ?? undefined);
    res.status(200).json(result);
  } catch (err) { handleError(res, err); }
});

export default router;
