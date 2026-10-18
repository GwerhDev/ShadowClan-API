import type { Types } from 'mongoose';
import Clan from '../models/Clan';
import Character from '../models/Character';
import Attendance from '../models/Attendance';
import Cycle from '../models/Cycle';
import ClanMembership from '../models/ClanMembership';
import { SW_KINDS } from './activityKinds';
import { badRequest } from './http';
import type { IRaffleRule, RaffleActivity, RaffleRange } from '../types';

// Elegibilidad de sorteos: asistencia de la plantilla actual del clan a Guerra Sombría y
// Vigilia de Espadas en un período (30/60/90 días o un ciclo del clan), contra reglas por
// actividad (mínimo de asistencias o mínimo %). Igual que en el resumen de asistencia, solo
// cuentan las instancias completadas posteriores al ingreso del miembro.

export const RAFFLE_ACTIVITIES: RaffleActivity[] = ['shadow_war', 'vigil_of_blades'];

export type RosterRole = 'leader' | 'officer' | 'member';

export interface RafflePeriod {
  range: RaffleRange;
  since: Date;
  until: Date;
  cycle: { _id: Types.ObjectId; activityType: string; startDate: Date; endDate?: Date } | null;
}

export interface ActivityStats { attended: number; total: number; percentage: number }

export interface RosterMember {
  _id: string;
  name: string;
  currentClass: string | null;
  role: RosterRole;
}

export interface RaffleMember extends RosterMember {
  stats: Record<RaffleActivity, ActivityStats>;
  /** Cumple los requisitos de asistencia. */
  meetsAttendance: boolean;
  /** Líder/oficial y el sorteo no los incluye (se pueden agregar a mano igual). */
  excludedStaff: boolean;
  eligible: boolean;
}

export async function resolvePeriod(clanId: Types.ObjectId | string, range: RaffleRange, cycleId?: string): Promise<RafflePeriod> {
  if (range === 'cycle') {
    const cycle = await Cycle.findOne({ _id: cycleId, clan: clanId }).select('activityType startDate endDate').lean();
    if (!cycle) throw badRequest('El ciclo seleccionado no existe en este clan.');
    return {
      range,
      since: cycle.startDate,
      until: cycle.endDate ?? new Date(),
      cycle: { _id: cycle._id as Types.ObjectId, activityType: cycle.activityType, startDate: cycle.startDate, endDate: cycle.endDate },
    };
  }
  const until = new Date();
  const since = new Date(until);
  since.setDate(since.getDate() - Number(range));
  return { range, since, until, cycle: null };
}

const startOfDay = (d: Date) => new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()));

/** Plantilla actual del clan (líder, oficiales y miembros), ordenada por rol y nombre. */
export async function clanRoster(clanId: Types.ObjectId | string): Promise<RosterMember[]> {
  const clan = await Clan.findById(clanId).select('leader officer member').lean();
  if (!clan) return [];
  const role = new Map<string, RosterRole>();
  for (const m of clan.member ?? []) role.set(String(m), 'member');
  for (const o of clan.officer ?? []) role.set(String(o), 'officer');
  if (clan.leader) role.set(String(clan.leader), 'leader');
  const order: Record<RosterRole, number> = { leader: 0, officer: 1, member: 2 };
  const chars = await Character.find({ _id: { $in: [...role.keys()] } }).select('name currentClass').lean();
  return chars
    .map(c => ({
      _id: String(c._id),
      name: c.name,
      currentClass: c.currentClass ?? null,
      role: role.get(String(c._id)) ?? 'member',
    }))
    .sort((a, b) => order[a.role] - order[b.role] || a.name.localeCompare(b.name));
}

export function meetsRules(stats: Record<RaffleActivity, ActivityStats>, rules: IRaffleRule[]): boolean {
  return rules.every(r => {
    const s = stats[r.activity];
    return r.mode === 'count' ? s.attended >= r.min : s.percentage >= r.min;
  });
}

export async function computeEligibility(
  clanId: Types.ObjectId | string,
  period: RafflePeriod,
  rules: IRaffleRule[],
  includeStaff = false,
) {
  const roster = await clanRoster(clanId);
  const ids = roster.map(m => m._id);

  const memberships = await ClanMembership.find({ clan: clanId, character: { $in: ids }, leftAt: null })
    .select('character joinedAt').lean();
  const joinedAt = new Map<string, Date>();
  for (const m of memberships) if (m.joinedAt) joinedAt.set(String(m.character), startOfDay(new Date(m.joinedAt)));

  // Instancias completadas del período por actividad + asistencias marcadas.
  const instances = {} as Record<RaffleActivity, Array<{ _id: unknown; date: Date }>>;
  for (const a of RAFFLE_ACTIVITIES) {
    instances[a] = await SW_KINDS[a].Model.find({ clan: clanId, completed: true, date: { $gte: period.since, $lte: period.until } })
      .select('_id date').lean();
  }
  const allInstanceIds = RAFFLE_ACTIVITIES.flatMap(a => instances[a].map(i => i._id));
  const records = allInstanceIds.length && ids.length
    ? await Attendance.find({ shadowWar: { $in: allInstanceIds }, character: { $in: ids }, attended: true }).select('character shadowWar').lean()
    : [];
  const attended = new Map<string, Set<string>>();
  for (const r of records) {
    const k = String(r.character);
    if (!attended.has(k)) attended.set(k, new Set());
    attended.get(k)!.add(String(r.shadowWar));
  }

  const members: RaffleMember[] = roster.map(m => {
    const since = joinedAt.get(m._id);
    const stats = {} as Record<RaffleActivity, ActivityStats>;
    for (const a of RAFFLE_ACTIVITIES) {
      const own = since ? instances[a].filter(i => new Date(i.date) >= since) : instances[a];
      const count = own.filter(i => attended.get(m._id)?.has(String(i._id))).length;
      stats[a] = { attended: count, total: own.length, percentage: own.length ? Math.round((count / own.length) * 100) : 0 };
    }
    const meetsAttendance = meetsRules(stats, rules);
    const excludedStaff = !includeStaff && m.role !== 'member';
    return { ...m, stats, meetsAttendance, excludedStaff, eligible: meetsAttendance && !excludedStaff };
  });

  const totals = {} as Record<RaffleActivity, number>;
  for (const a of RAFFLE_ACTIVITIES) totals[a] = instances[a].length;

  return { period, totals, members };
}
