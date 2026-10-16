import ShadowWar from '../models/ShadowWar';
import AccursedTower from '../models/AccursedTower';
import { timezoneOffset } from '../config';

// Completado bajo demanda de Guerras Sombrías y Torres Malditas cuya fecha ya pasó.
// Se invoca al consultar o listar instancias (no hay jobs periódicos).
// Las instancias guardan solo el día (sin hora de juego), así que "ya pasó" significa
// que terminó su día en la zona horaria del clan (TIMEZONE_OFFSET, por defecto -3).

/** Instante UTC de la medianoche local (según `offsetHours`) del día que contiene `now`. */
export function startOfLocalDay(now: Date, offsetHours: number = timezoneOffset): Date {
  const local = new Date(now.getTime() + offsetHours * 3_600_000);
  const midnightLocalAsUtc = Date.UTC(local.getUTCFullYear(), local.getUTCMonth(), local.getUTCDate());
  return new Date(midnightLocalAsUtc - offsetHours * 3_600_000);
}

/** ¿La fecha de la instancia ya pasó (su día local terminó)? */
export function isPastActivityDate(date: Date | string | undefined | null, now: Date = new Date()): boolean {
  if (!date) return false;
  return new Date(date) < startOfLocalDay(now);
}

/**
 * Marca como completadas las instancias vencidas. Con `clanId` se limita a ese clan
 * (lo normal: se llama justo antes de leer los datos del clan); sin él, a todas
 * (vistas globales del Dashboard). Un solo updateMany por colección.
 */
export async function completeExpiredActivities(clanId?: unknown): Promise<void> {
  const filter: Record<string, unknown> = { completed: { $ne: true }, date: { $lt: startOfLocalDay(new Date()) } };
  if (clanId) filter.clan = clanId;
  await Promise.all([
    ShadowWar.updateMany(filter, { $set: { completed: true } }),
    AccursedTower.updateMany(filter, { $set: { completed: true } }),
  ]);
}

/** Completa una instancia puntual si está vencida (detalle por id). */
export async function completeExpiredById(kind: 'shadow_war' | 'accursed_tower', id: unknown): Promise<void> {
  const Model = (kind === 'shadow_war' ? ShadowWar : AccursedTower) as typeof ShadowWar;
  await Model.updateOne(
    { _id: id, completed: { $ne: true }, date: { $lt: startOfLocalDay(new Date()) } },
    { $set: { completed: true } },
  );
}
