import { Types } from 'mongoose';
import ClanMembership from '../models/ClanMembership';
import Character from '../models/Character';
import { syncClanRoomsForCharacter } from '../socket';

type Role = 'leader' | 'officer' | 'member';

// Idempotente: si ya existe un registro abierto para este (character, clan), lo devuelve
// tal cual en vez de duplicarlo. Esto permite llamarla sin condición en cada punto que
// agrega a alguien a member/officer/leader, sin tener que distinguir "ingreso nuevo" de
// "ya era miembro" caso por caso.
export async function openMembership(
  characterId: Types.ObjectId | string,
  clanId: Types.ObjectId | string,
  role: Role = 'member',
) {
  const existing = await ClanMembership.findOne({ character: characterId, clan: clanId, leftAt: null });
  if (existing) return existing;
  const created = await ClanMembership.create({ clan: clanId, character: characterId, role, joinedAt: new Date() });
  void syncClanRoomsForCharacter(characterId);
  return created;
}

// Mantiene el `role` del registro abierto al día cuando alguien cambia de rol sin
// dejar el clan (ascenso a oficial, etc.) — no abre ni cierra nada, solo corrige
// el dato para que la vista de exmiembros muestre el rol correcto al salir.
export async function updateOpenRole(
  characterId: Types.ObjectId | string,
  clanId: Types.ObjectId | string,
  role: Role,
) {
  return ClanMembership.updateOne({ character: characterId, clan: clanId, leftAt: null }, { role });
}

// Cierra el registro abierto para este (character, clan). Si no hay uno — típicamente
// porque la membresía es anterior a esta feature y nunca pasó por openMembership — por
// default deja igual un registro YA CERRADO (joinedAt desconocido) para que la salida
// no se pierda y el personaje aparezca en exmiembros. Pasar `backfill: false` solo en
// limpiezas defensivas donde no hay certeza de que el personaje haya sido miembro real
// (ej. rechazar una invitación nunca aceptada) — ahí sí debe ser un no-op silencioso.
export async function closeMembership(
  characterId: Types.ObjectId | string,
  clanId: Types.ObjectId | string,
  opts?: { expulsionReason?: string; removedBy?: Types.ObjectId | string; role?: Role; backfill?: boolean },
) {
  const updated = await ClanMembership.findOneAndUpdate(
    { character: characterId, clan: clanId, leftAt: null },
    { leftAt: new Date(), expulsionReason: opts?.expulsionReason, removedBy: opts?.removedBy },
  );
  void syncClanRoomsForCharacter(characterId);
  if (updated || opts?.backfill === false) return updated;
  return ClanMembership.create({
    clan: clanId, character: characterId, role: opts?.role ?? 'member',
    leftAt: new Date(), expulsionReason: opts?.expulsionReason, removedBy: opts?.removedBy,
  });
}

export type RosterRole = 'leader' | 'officer' | 'member';

/** Mapa characterId → rol actual dentro del documento Clan. */
export function rosterRoles(clan: { leader?: unknown; officer?: unknown[]; member?: unknown[] }): Map<string, RosterRole> {
  const m = new Map<string, RosterRole>();
  for (const id of clan.member  ?? []) m.set(String(id), 'member');
  for (const id of clan.officer ?? []) m.set(String(id), 'officer');
  if (clan.leader) m.set(String(clan.leader), 'leader');
  return m;
}

/**
 * Mantiene Character.clan y ClanMembership coherentes tras un cambio de plantilla hecho
 * por un admin: abre membresía a los que entran, actualiza el rol a los que cambian y
 * cierra (y desvincula) a los que salen.
 */
export async function syncRosterChange(
  clanId: Types.ObjectId | string,
  before: Map<string, RosterRole>,
  after: Map<string, RosterRole>,
  actorUserId: Types.ObjectId | string,
) {
  const ops: Promise<unknown>[] = [];
  for (const [id, role] of after) {
    const prev = before.get(id);
    if (!prev) {
      ops.push(Character.findByIdAndUpdate(id, { clan: clanId }).then(() => openMembership(id, clanId, role)));
    } else if (prev !== role) {
      ops.push(openMembership(id, clanId, prev).then(() => updateOpenRole(id, clanId, role)));
    }
  }
  for (const [id, role] of before) {
    if (after.has(id)) continue;
    ops.push(Character.updateOne({ _id: id, clan: clanId }, { $unset: { clan: '' } })
      .then(() => closeMembership(id, clanId, { removedBy: actorUserId, role })));
  }
  const results = await Promise.allSettled(ops);
  for (const r of results) if (r.status === 'rejected') console.error('syncRosterChange:', r.reason);
}
