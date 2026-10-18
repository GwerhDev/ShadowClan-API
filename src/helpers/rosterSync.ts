import type { Types } from 'mongoose';
import Clan from '../models/Clan';
import Character from '../models/Character';
import type { IClan } from '../types';
import { escapeRegex } from './clanScope';
import { mergedScore } from './score';
import { openMembership, closeMembership } from './clanMembership';
import {
  findWarsByDate, datesWithoutWar, upsertAttendance,
  type RosterParseResult, type RosterRow,
} from './rosterImport';

// Sincronización de la plantilla de un clan desde la planilla (reemplaza member[]).
// Se hace en dos pasos: `previewRosterSync` (no escribe) devuelve qué pasará y los
// personajes nuevos; `applyRosterSync` aplica con las decisiones del usuario para cada
// nuevo: crearlo o "reemplazar" a uno existente (ese personaje toma el nombre y atributos
// nuevos y conserva su _id, historial de membresía y asistencia).

export type SyncResolution = { action: 'create' } | { action: 'replace'; characterId: string };
/** nombre (minúsculas) → decisión. Sin decisión, un nuevo se crea. */
export type SyncResolutions = Record<string, SyncResolution>;

type CharLite = { _id: Types.ObjectId; name: string; clan?: Types.ObjectId | null; currentClass?: string };

type RowPlan =
  | { kind: 'update';   row: RosterRow; char: CharLite; privileged: boolean }
  | { kind: 'rejoin';   row: RosterRow; char: CharLite }
  | { kind: 'transfer'; row: RosterRow; char: CharLite; fromClan: { _id: Types.ObjectId; name: string; isLeader: boolean } }
  | { kind: 'new';      row: RosterRow };

interface SyncPlan {
  plans: RowPlan[];
  /** Miembros (no líder/oficiales) que no aparecen en la planilla: saldrán del clan. */
  leaving: CharLite[];
  /** Todos los de la plantilla actual (incl. líder/oficiales) que no figuran en la planilla:
   *  únicos candidatos para "reemplazar" (p. ej. cambiaron de nombre en el juego). */
  missing: CharLite[];
  privilegedIds: Set<string>;
}

const lower = (s: string) => s.trim().toLowerCase();

async function buildPlan(clan: IClan, parsed: RosterParseResult): Promise<SyncPlan> {
  const privilegedIds = new Set([...(clan.leader ? [String(clan.leader)] : []), ...(clan.officer ?? []).map(String)]);
  const rosterIds = [...privilegedIds, ...(clan.member ?? []).map(String)];
  const roster = await Character.find({ _id: { $in: rosterIds } }).select('_id name clan currentClass').lean<CharLite[]>();
  const rosterByName = new Map(roster.map(c => [lower(c.name), c]));

  // Personajes fuera de la plantilla con nombres de la planilla (una consulta).
  const outsideNames = parsed.rows.map(r => r.name).filter(n => !rosterByName.has(lower(n)));
  const outside = outsideNames.length
    ? await Character.find({ $or: outsideNames.map(n => ({ name: { $regex: `^${escapeRegex(n)}$`, $options: 'i' } })) })
        .select('_id name clan currentClass').lean<CharLite[]>()
    : [];
  const outsideByName = new Map(outside.map(c => [lower(c.name), c]));
  const otherClanIds = [...new Set(outside.filter(c => c.clan && String(c.clan) !== String(clan._id)).map(c => String(c.clan)))];
  const otherClans = otherClanIds.length
    ? await Clan.find({ _id: { $in: otherClanIds } }).select('_id name leader').lean<Array<{ _id: Types.ObjectId; name: string; leader?: Types.ObjectId }>>()
    : [];
  const otherClanById = new Map(otherClans.map(c => [String(c._id), c]));

  const plans: RowPlan[] = parsed.rows.map(row => {
    const inRoster = rosterByName.get(lower(row.name));
    if (inRoster) return { kind: 'update', row, char: inRoster, privileged: privilegedIds.has(String(inRoster._id)) };
    const ext = outsideByName.get(lower(row.name));
    if (!ext) return { kind: 'new', row };
    if (!ext.clan || String(ext.clan) === String(clan._id)) return { kind: 'rejoin', row, char: ext };
    const oc = otherClanById.get(String(ext.clan));
    return {
      kind: 'transfer', row, char: ext,
      fromClan: { _id: ext.clan as Types.ObjectId, name: oc?.name ?? '—', isLeader: !!oc?.leader && String(oc.leader) === String(ext._id) },
    };
  });

  const inFile = new Set(plans.filter(p => p.kind === 'update').map(p => String((p as { char: CharLite }).char._id)));
  const missing = roster.filter(c => !inFile.has(String(c._id)));
  const leaving = missing.filter(c => !privilegedIds.has(String(c._id)));
  return { plans, leaving, missing, privilegedIds };
}

const lite = (c: CharLite) => ({ _id: String(c._id), name: c.name, currentClass: c.currentClass ?? null });
const roleOf = (clan: IClan, c: CharLite, privileged: Set<string>): 'leader' | 'officer' | 'member' =>
  String(clan.leader) === String(c._id) ? 'leader' : privileged.has(String(c._id)) ? 'officer' : 'member';

export async function previewRosterSync(clan: IClan, parsed: RosterParseResult) {
  const { plans, leaving, missing, privilegedIds } = await buildPlan(clan, parsed);
  const wars = await findWarsByDate(parsed.dateColumns.map(d => d.date), clan._id);
  const count = (k: RowPlan['kind']) => plans.filter(p => p.kind === k).length;
  return {
    summary: { rows: plans.length, updated: count('update'), rejoin: count('rejoin'), transfer: count('transfer'), new: count('new'), leaving: leaving.length },
    newCharacters: plans.filter(p => p.kind === 'new').map(p => ({ name: p.row.name, row: p.row.row, data: p.row.data })),
    transfers: plans.filter((p): p is Extract<RowPlan, { kind: 'transfer' }> => p.kind === 'transfer')
      .map(p => ({ name: p.row.name, fromClan: p.fromClan.name, blocked: p.fromClan.isLeader })),
    /** Candidatos para reemplazar: los de la plantilla actual que no figuran en la planilla. */
    candidates: missing.map(c => ({ ...lite(c), role: roleOf(clan, c, privilegedIds) })),
    warnings: { ...parsed.warnings, datesWithoutWar: datesWithoutWar(parsed, wars) },
  };
}

export class SyncResolutionError extends Error {}

export async function applyRosterSync(
  clan: IClan & { save(): Promise<unknown> },
  parsed: RosterParseResult,
  resolutions: SyncResolutions,
  actorUserId: Types.ObjectId | string,
) {
  const { plans, leaving, missing, privilegedIds } = await buildPlan(clan, parsed);
  const wars = await findWarsByDate(parsed.dateColumns.map(d => d.date), clan._id);

  // Validar reemplazos: el destino debe estar hoy en el clan sin figurar en la planilla, y no
  // puede usarse dos veces.
  const missingIds = new Set(missing.map(c => String(c._id)));
  const usedTargets = new Set<string>();
  for (const p of plans) {
    if (p.kind !== 'new') continue;
    const r = resolutions[lower(p.row.name)];
    if (r?.action !== 'replace') continue;
    if (!missingIds.has(r.characterId)) {
      throw new SyncResolutionError(`No se puede reemplazar con "${p.row.name}": el personaje elegido debe estar en el clan y no figurar en la planilla.`);
    }
    if (usedTargets.has(r.characterId)) throw new SyncResolutionError('Un mismo personaje fue elegido para reemplazar a más de un nombre nuevo.');
    usedTargets.add(r.characterId);
  }

  type Result = { name: string; status: 'created' | 'updated' | 'replaced' | 'rejoined' | 'transferred' | 'skipped'; previousName?: string; reason?: string };
  const results: Result[] = [];
  const memberIds: string[] = [];

  for (const p of plans) {
    const { row } = p;
    if (p.kind === 'update') {
      const full = await Character.findById(p.char._id);
      await Character.updateOne({ _id: p.char._id }, { ...row.data, score: mergedScore(row.data, full), clan: clan._id });
      await upsertAttendance(row.attendedDates, p.char._id, clan._id, wars);
      if (!p.privileged) { memberIds.push(String(p.char._id)); await openMembership(p.char._id, clan._id, 'member'); }
      results.push({ name: row.name, status: 'updated' });
      continue;
    }
    if (p.kind === 'transfer' && p.fromClan.isLeader) {
      results.push({ name: row.name, status: 'skipped', reason: `Es líder de ${p.fromClan.name}.` });
      continue;
    }
    if (p.kind === 'transfer') {
      // Sale de su clan anterior con historial antes de entrar a este.
      await Clan.updateOne({ _id: p.fromClan._id }, { $pull: { member: p.char._id, officer: p.char._id } });
      await closeMembership(p.char._id, p.fromClan._id, { removedBy: actorUserId, expulsionReason: `Cambio a ${clan.name ?? 'otro clan'} (sincronización)` });
    }
    let charId: Types.ObjectId;
    let status: Result['status'];
    let previousName: string | undefined;
    if (p.kind === 'new') {
      const r = resolutions[lower(row.name)];
      if (r?.action === 'replace') {
        const target = await Character.findById(r.characterId);
        if (!target) throw new SyncResolutionError('El personaje a reemplazar ya no existe.');
        previousName = target.name;
        // Conserva el _id (historial y asistencia); toma el nombre y atributos de la planilla.
        await Character.updateOne({ _id: target._id }, { ...row.data, name: row.name, score: mergedScore(row.data, target), clan: clan._id });
        charId = target._id as Types.ObjectId;
        status = 'replaced';
      } else {
        const created = await new Character({ name: row.name, ...row.data, score: mergedScore(row.data), status: 'unclaimed', clan: clan._id }).save();
        charId = created._id as Types.ObjectId;
        status = 'created';
      }
    } else {
      const full = await Character.findById(p.char._id);
      await Character.updateOne({ _id: p.char._id }, { ...row.data, score: mergedScore(row.data, full), clan: clan._id });
      charId = p.char._id;
      status = p.kind === 'transfer' ? 'transferred' : 'rejoined';
    }
    await upsertAttendance(row.attendedDates, charId, clan._id, wars);
    // Un líder/oficial reemplazado conserva su rol (no pasa a member[]).
    if (!privilegedIds.has(String(charId))) {
      await openMembership(charId, clan._id, 'member');
      memberIds.push(String(charId));
    }
    results.push({ name: row.name, status, ...(previousName ? { previousName } : {}) });
  }

  // Los miembros que no están en la planilla (ni fueron reemplazados) salen del clan.
  const removedIds = leaving.map(c => String(c._id)).filter(id => !memberIds.includes(id));
  if (removedIds.length) {
    await Character.updateMany({ _id: { $in: removedIds }, clan: clan._id }, { $unset: { clan: '' } });
    await Promise.all(removedIds.map(id => closeMembership(id, clan._id, { removedBy: actorUserId })));
  }

  clan.member = [...new Set(memberIds)] as unknown as typeof clan.member;
  await clan.save();

  return {
    processed: results.length,
    removed: removedIds.length,
    results,
    warnings: { ...parsed.warnings, datesWithoutWar: datesWithoutWar(parsed, wars) },
  };
}
