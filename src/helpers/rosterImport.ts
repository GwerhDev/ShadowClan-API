import ShadowWar from '../models/ShadowWar';
import Attendance from '../models/Attendance';

// Helpers compartidos por la importación/sincronización de plantilla desde CSV/XLSX
// (admin/clans y clan-management/clan).

// Spanish class name → system value
const CLASS_MAP: Record<string, string> = {
  'druida': 'druid',
  'bárbaro': 'barbarian', 'barbaro': 'barbarian',
  'caballero de sangre': 'bloodknight', 'caballero sangriento': 'bloodknight',
  'guerrero divino': 'crusader',
  'cazador de demonios': 'demonhunter',
  'monje': 'monk',
  'nigromante': 'necromancer',
  'tempest': 'tempest',
  'arcanista': 'wizard',
  'conjurador': 'warlock',
};
const VALID_CLASS_VALUES = new Set(Object.values(CLASS_MAP));

export function resolveClass(raw: unknown): string | undefined {
  if (!raw) return undefined;
  const key = String(raw).trim().toLowerCase();
  return CLASS_MAP[key] ?? (VALID_CLASS_VALUES.has(key) ? key : undefined);
}

export function num(v: unknown): number | undefined {
  const n = Number(v);
  return isNaN(n) || v === '' || v === null || v === undefined ? undefined : n;
}

// ── Attendance import ─────────────────────────────────────────────────────────
const MONTH_MAP: Record<string, number> = {
  ene: 1, feb: 2, mar: 3, abr: 4, may: 5, jun: 6, jul: 7, ago: 8, sep: 9, oct: 10, nov: 11, dic: 12,
};
const NON_DATE_COLS = new Set(['Rank', 'Jugador', 'Armadura', 'Penetracion', 'Potencia', 'Resistencia', 'Resonancia', 'Score', 'Clase', 'Whatsapp', 'Observaciones', 'Asist']);

const DAY_MS = 86_400_000;
// Margen hacia el futuro: una columna con fecha más allá de esto se asume del año anterior
// (ej. planilla de dic importada en enero).
const FUTURE_TOLERANCE_MS = 7 * DAY_MS;

/**
 * Convierte una columna tipo "12dic" en 'YYYY-MM-DD'. Las columnas no traen año:
 * se asume el año actual salvo que eso deje la fecha en el futuro, en cuyo caso
 * corresponde al año anterior.
 */
export function parseDateCol(col: string, now: Date = new Date()): string | null {
  const m = col.match(/^(\d{1,2})([a-z]+)$/i);
  if (!m) return null;
  const month = MONTH_MAP[m[2].toLowerCase()];
  if (!month) return null;
  const day = parseInt(m[1], 10);
  if (day < 1 || day > 31) return null;
  let year = now.getUTCFullYear();
  if (Date.UTC(year, month - 1, day) > now.getTime() + FUTURE_TOLERANCE_MS) year -= 1;
  return `${year}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
}

type SwRef = { _id: unknown; date: Date };

/** Mapa columna → Shadow War de ese día (o null). Una sola consulta para todas las columnas. */
export async function buildSwByDate(rows: Record<string, unknown>[], clanId: unknown): Promise<Map<string, SwRef | null>> {
  const now = new Date();
  const allCols = rows.length ? Object.keys(rows[0]) : [];
  const colDates = new Map<string, string>();
  for (const c of allCols) {
    if (NON_DATE_COLS.has(c)) continue;
    const d = parseDateCol(c, now);
    if (d) colDates.set(c, d);
  }
  const map = new Map<string, SwRef | null>();
  if (!colDates.size) return map;

  const days  = [...colDates.values()].sort();
  const start = new Date(days[0] + 'T00:00:00.000Z');
  const end   = new Date(days[days.length - 1] + 'T23:59:59.999Z');
  const sws   = await ShadowWar.find({ clan: clanId, date: { $gte: start, $lte: end } }).select('_id date').lean();
  const byDay = new Map<string, SwRef>();
  for (const sw of sws) {
    const key = new Date(sw.date).toISOString().slice(0, 10);
    if (!byDay.has(key)) byDay.set(key, sw as SwRef);
  }
  for (const [col, day] of colDates) map.set(col, byDay.get(day) ?? null);
  return map;
}

/** Marca asistencia (attended=true) en cada Shadow War cuya columna tenga un 1. */
export async function upsertAttendance(
  row: Record<string, unknown>,
  characterId: unknown,
  clanId: unknown,
  swByDate: Map<string, SwRef | null>,
): Promise<void> {
  const ops = [];
  for (const [col, sw] of swByDate) {
    if (!sw || Number(row[col]) !== 1) continue;
    ops.push({
      updateOne: {
        filter: { shadowWar: sw._id, character: characterId },
        update: { $set: { attended: true, clan: clanId, date: sw.date, activityType: 'shadow_war' } },
        upsert: true,
      },
    });
  }
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  if (ops.length) await Attendance.bulkWrite(ops as any);
}
