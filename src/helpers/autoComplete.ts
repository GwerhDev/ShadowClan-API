import ShadowWar from '../models/ShadowWar';
import AccursedTower from '../models/AccursedTower';
import VigilOfBlades from '../models/VigilOfBlades';
import { timezoneOffset } from '../config';

// Completado bajo demanda de instancias (Guerra Sombría, Torre Maldita, Vigilia de Espadas)
// cuya hora de término ya pasó. Se invoca al consultar o listar instancias (sin jobs).
// Las instancias guardan solo el día (su fecha UTC); la hora de término es hora local
// del clan (TIMEZONE_OFFSET, por defecto -3) y depende del tipo de instancia.

export type ActivityKind = 'shadow_war' | 'accursed_tower' | 'vigil_of_blades';

/** Hora local de término de cada tipo: Guerra y Torre terminan a las 20:00; la Vigilia
 *  comienza a las 20:00 y se considera terminada a las 20:30. */
export const COMPLETION_TIME: Record<ActivityKind, { hour: number; minute: number }> = {
  shadow_war:      { hour: 20, minute: 0 },
  accursed_tower:  { hour: 20, minute: 0 },
  vigil_of_blades: { hour: 20, minute: 30 },
};

/** Compatibilidad: hora de término de Guerra Sombría / Torre. */
export const COMPLETION_HOUR = COMPLETION_TIME.shadow_war.hour;

/**
 * Límite UTC para el filtro de vencidas: toda instancia con `date` anterior a este
 * instante ya llegó a su hora de término. Es la medianoche UTC siguiente al último
 * día cuya hora de término (local) ya pasó.
 */
export function completionCutoff(
  now: Date = new Date(),
  offsetHours: number = timezoneOffset,
  hour: number = COMPLETION_TIME.shadow_war.hour,
  minute: number = 0,
): Date {
  const local = new Date(now.getTime() + offsetHours * 3_600_000);
  const minutesNow = local.getUTCHours() * 60 + local.getUTCMinutes();
  // Último día (local) cuyo término ya pasó: hoy si ya es la hora, si no ayer.
  const doneToday = minutesNow >= hour * 60 + minute;
  const lastDone = Date.UTC(local.getUTCFullYear(), local.getUTCMonth(), local.getUTCDate() - (doneToday ? 0 : 1));
  return new Date(lastDone + 86_400_000);
}

const cutoffFor = (kind: ActivityKind, now: Date = new Date()) =>
  completionCutoff(now, timezoneOffset, COMPLETION_TIME[kind].hour, COMPLETION_TIME[kind].minute);

/** ¿La instancia de esta fecha ya llegó a su hora de término? */
export function isPastActivityDate(
  date: Date | string | undefined | null,
  now: Date = new Date(),
  kind: ActivityKind = 'shadow_war',
): boolean {
  if (!date) return false;
  return new Date(date) < cutoffFor(kind, now);
}

const MODELS: Record<ActivityKind, typeof ShadowWar> = {
  shadow_war:      ShadowWar,
  accursed_tower:  AccursedTower as unknown as typeof ShadowWar,
  vigil_of_blades: VigilOfBlades,
};

/**
 * Marca como completadas las instancias vencidas de todos los tipos. Con `clanId` se
 * limita a ese clan (lo normal: se llama justo antes de leer los datos del clan); sin él,
 * a todas (vistas globales del Dashboard). Un solo updateMany por colección.
 */
export async function completeExpiredActivities(clanId?: unknown): Promise<void> {
  const now = new Date();
  await Promise.all((Object.keys(MODELS) as ActivityKind[]).map(kind => {
    const filter: Record<string, unknown> = { completed: { $ne: true }, date: { $lt: cutoffFor(kind, now) } };
    if (clanId) filter.clan = clanId;
    return MODELS[kind].updateMany(filter, { $set: { completed: true } });
  }));
}

/** Completa una instancia puntual si está vencida (detalle por id). */
export async function completeExpiredById(kind: ActivityKind, id: unknown): Promise<void> {
  await MODELS[kind].updateOne(
    { _id: id, completed: { $ne: true }, date: { $lt: cutoffFor(kind) } },
    { $set: { completed: true } },
  );
}
