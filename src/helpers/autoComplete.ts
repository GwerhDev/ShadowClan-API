import ShadowWar from '../models/ShadowWar';
import AccursedTower from '../models/AccursedTower';
import { timezoneOffset } from '../config';

// Completado bajo demanda de Guerras Sombrías y Torres Malditas cuya hora ya pasó.
// Se invoca al consultar o listar instancias (no hay jobs periódicos).
// Las instancias guardan solo el día (su fecha UTC); dentro del juego terminan a las
// 20:00 hora local del clan (TIMEZONE_OFFSET, por defecto -3), así que una instancia
// se considera completada desde las 20:00 locales de su fecha.

export const COMPLETION_HOUR = 20;

/**
 * Límite UTC para el filtro de vencidas: toda instancia con `date` anterior a este
 * instante ya llegó a su hora de término. Es la medianoche UTC siguiente al último
 * día cuyas 20:00 locales ya pasaron.
 */
export function completionCutoff(now: Date = new Date(), offsetHours: number = timezoneOffset, hour: number = COMPLETION_HOUR): Date {
  const local = new Date(now.getTime() + offsetHours * 3_600_000);
  // Último día (local) cuya hora de término ya pasó: hoy si ya son las `hour`, si no ayer.
  const lastDone = Date.UTC(local.getUTCFullYear(), local.getUTCMonth(), local.getUTCDate() - (local.getUTCHours() < hour ? 1 : 0));
  return new Date(lastDone + 86_400_000);
}

/** ¿La instancia de esta fecha ya llegó a su hora de término (20:00 locales)? */
export function isPastActivityDate(date: Date | string | undefined | null, now: Date = new Date()): boolean {
  if (!date) return false;
  return new Date(date) < completionCutoff(now);
}

/**
 * Marca como completadas las instancias vencidas. Con `clanId` se limita a ese clan
 * (lo normal: se llama justo antes de leer los datos del clan); sin él, a todas
 * (vistas globales del Dashboard). Un solo updateMany por colección.
 */
export async function completeExpiredActivities(clanId?: unknown): Promise<void> {
  const filter: Record<string, unknown> = { completed: { $ne: true }, date: { $lt: completionCutoff() } };
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
    { _id: id, completed: { $ne: true }, date: { $lt: completionCutoff() } },
    { $set: { completed: true } },
  );
}
