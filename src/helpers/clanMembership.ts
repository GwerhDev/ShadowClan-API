import { Types } from 'mongoose';
import ClanMembership from '../models/ClanMembership';

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
  return ClanMembership.create({ clan: clanId, character: characterId, role, joinedAt: new Date() });
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
  if (updated || opts?.backfill === false) return updated;
  return ClanMembership.create({
    clan: clanId, character: characterId, role: opts?.role ?? 'member',
    leftAt: new Date(), expulsionReason: opts?.expulsionReason, removedBy: opts?.removedBy,
  });
}
