import * as XLSX from 'xlsx';
import ShadowWar from '../models/ShadowWar';
import Attendance from '../models/Attendance';

// Lectura de la planilla de plantilla (CSV/XLSX) compartida por la sincronización e
// importación de miembros (clan-management y admin).
//
// Formato: primera hoja, fila 1 = encabezados. Columnas reconocidas (sin distinguir
// mayúsculas, tildes ni espacios): Jugador (obligatoria), Resonancia, Armadura,
// Penetracion, Potencia, Resistencia, Clase, Whatsapp. Las columnas de fecha marcan
// asistencia a la Guerra Sombría de ese día con un 1. Rank/Score/Observaciones/Asist
// se ignoran.

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

/** Minúsculas, sin tildes ni espacios: "Penetración " → "penetracion". */
const normalize = (s: unknown) => String(s ?? '').normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/\s+/g, '').toLowerCase();

// ── Fechas de asistencia ─────────────────────────────────────────────────────

/** Meses en español e inglés (abreviados y completos, + "sept"/"set"). */
const MONTHS: Record<string, number> = {};
const MONTH_WORDS: Array<[number, string[]]> = [
  [1,  ['ene', 'enero', 'jan', 'january']],
  [2,  ['feb', 'febrero', 'february']],
  [3,  ['mar', 'marzo', 'march']],
  [4,  ['abr', 'abril', 'apr', 'april']],
  [5,  ['may', 'mayo']],
  [6,  ['jun', 'junio', 'june']],
  [7,  ['jul', 'julio', 'july']],
  [8,  ['ago', 'agosto', 'aug', 'august']],
  [9,  ['sep', 'sept', 'set', 'septiembre', 'setiembre', 'september']],
  [10, ['oct', 'octubre', 'october']],
  [11, ['nov', 'noviembre', 'november']],
  [12, ['dic', 'diciembre', 'dec', 'december']],
];
for (const [m, words] of MONTH_WORDS) for (const w of words) MONTHS[w] = m;

const DAY_MS = 86_400_000;
// Margen hacia el futuro: una columna sin año con fecha más allá de esto se asume del año
// anterior (ej. planilla de dic importada en enero).
const FUTURE_TOLERANCE_MS = 7 * DAY_MS;

const ymd = (y: number, m: number, d: number) => `${y}-${String(m).padStart(2, '0')}-${String(d).padStart(2, '0')}`;

function inferYear(month: number, day: number, now: Date): number {
  let year = now.getUTCFullYear();
  if (Date.UTC(year, month - 1, day) > now.getTime() + FUTURE_TOLERANCE_MS) year -= 1;
  return year;
}

function validDay(y: number, m: number, d: number): boolean {
  const dt = new Date(Date.UTC(y, m - 1, d));
  return dt.getUTCFullYear() === y && dt.getUTCMonth() === m - 1 && dt.getUTCDate() === d;
}

/**
 * Interpreta un encabezado de fecha y devuelve 'YYYY-MM-DD' (o null si no es fecha):
 *  - celda de fecha real (número de serie de Excel/Sheets) → su fecha exacta, con año;
 *  - texto "12dic", "3 sept", "01-Aug", "28 mayo 2026", "28/05" → año explícito o inferido.
 */
export function parseDateHeader(cell: unknown, now: Date = new Date()): string | null {
  if (cell instanceof Date && !isNaN(cell.getTime())) return ymd(cell.getUTCFullYear(), cell.getUTCMonth() + 1, cell.getUTCDate());
  if (typeof cell === 'number') {
    // Rango razonable de fechas de serie (≈1982–2119); evita confundir números chicos.
    if (cell < 30000 || cell > 80000) return null;
    const p = XLSX.SSF.parse_date_code(cell);
    return p && validDay(p.y, p.m, p.d) ? ymd(p.y, p.m, p.d) : null;
  }
  const s = normalize(cell).replace(/\./g, '');
  if (!s) return null;

  // dd + mes (+ año): "12dic", "3sept", "01-aug", "28mayo2026"
  let m = s.match(/^(\d{1,2})[-/]?([a-z]+)[-/]?(\d{2}|\d{4})?$/);
  if (m) {
    const month = MONTHS[m[2]];
    if (!month) return null;
    const day = parseInt(m[1], 10);
    const year = m[3] ? (m[3].length === 2 ? 2000 + parseInt(m[3], 10) : parseInt(m[3], 10)) : inferYear(month, day, now);
    return validDay(year, month, day) ? ymd(year, month, day) : null;
  }
  // dd/mm(/aaaa)
  m = s.match(/^(\d{1,2})[/-](\d{1,2})(?:[/-](\d{2}|\d{4}))?$/);
  if (m) {
    const day = parseInt(m[1], 10), month = parseInt(m[2], 10);
    if (month < 1 || month > 12) return null;
    const year = m[3] ? (m[3].length === 2 ? 2000 + parseInt(m[3], 10) : parseInt(m[3], 10)) : inferYear(month, day, now);
    return validDay(year, month, day) ? ymd(year, month, day) : null;
  }
  return null;
}

/** Compatibilidad: encabezado de texto → 'YYYY-MM-DD'. */
export function parseDateCol(col: string, now: Date = new Date()): string | null {
  return parseDateHeader(col, now);
}

// ── Lectura de la planilla ───────────────────────────────────────────────────

type FieldKey = 'name' | 'resonance' | 'armor' | 'armorPenetration' | 'power' | 'resistance' | 'currentClass' | 'whatsapp';
const FIELD_HEADERS: Record<string, FieldKey> = {
  jugador: 'name', nombre: 'name', personaje: 'name',
  resonancia: 'resonance',
  armadura: 'armor',
  penetracion: 'armorPenetration', penetraciondearmadura: 'armorPenetration',
  potencia: 'power',
  resistencia: 'resistance',
  clase: 'currentClass',
  whatsapp: 'whatsapp',
};
const IGNORED_HEADERS = new Set(['rank', 'score', 'observaciones', 'observacion', 'asist', 'asistencia', 'pos', '#']);

export interface RosterRow {
  /** Fila en la planilla (1 = encabezados). */
  row: number;
  name: string;
  /** Solo los campos presentes (no pisa valores existentes con vacíos). */
  data: Record<string, unknown>;
  /** Fechas 'YYYY-MM-DD' marcadas con 1 en la planilla. */
  attendedDates: string[];
}

export interface RosterParseWarnings {
  /** Encabezados que parecen fechas pero no se pudieron interpretar. */
  unreadableDateColumns: string[];
  /** Filas cuyo "Jugador" no es un nombre válido (p. ej. Sheets lo convirtió en fecha). */
  invalidNames: Array<{ row: number; value: string; reason: string }>;
  /** Nombres repetidos dentro de la planilla (se usa la primera aparición). */
  duplicateNames: string[];
}

export interface RosterParseResult {
  rows: RosterRow[];
  /** Columnas de fecha reconocidas: encabezado tal como se ve → 'YYYY-MM-DD'. */
  dateColumns: Array<{ header: string; date: string }>;
  warnings: RosterParseWarnings;
}

export class RosterFormatError extends Error {}

const cellText = (v: unknown) => (v instanceof Date ? v.toISOString().slice(0, 10) : String(v ?? '').trim());

/** Lee la primera hoja de la planilla. Lanza RosterFormatError si falta "Jugador". */
export function parseRosterFile(buffer: Buffer, now: Date = new Date()): RosterParseResult {
  const workbook = XLSX.read(buffer, { type: 'buffer' });
  const sheet    = workbook.Sheets[workbook.SheetNames[0]];
  if (!sheet) throw new RosterFormatError('La planilla no tiene hojas.');
  // Valores crudos (números de serie para fechas) + texto formateado para mostrar.
  const grid      = XLSX.utils.sheet_to_json<unknown[]>(sheet, { header: 1, defval: '', raw: true });
  const formatted = XLSX.utils.sheet_to_json<unknown[]>(sheet, { header: 1, defval: '', raw: false });
  const header    = (grid[0] ?? []) as unknown[];
  const headerTxt = (formatted[0] ?? []) as unknown[];

  const fieldCol: Partial<Record<FieldKey, number>> = {};
  const dateColumns: Array<{ col: number; header: string; date: string }> = [];
  const unreadableDateColumns: string[] = [];

  header.forEach((cell, col) => {
    const label = cellText(headerTxt[col] ?? cell);
    const key = normalize(label);
    if (!key) return;
    const field = FIELD_HEADERS[key];
    if (field) { if (fieldCol[field] === undefined) fieldCol[field] = col; return; }
    if (IGNORED_HEADERS.has(key)) return;
    const date = parseDateHeader(cell, now);
    if (date) { dateColumns.push({ col, header: label, date }); return; }
    // Algo con dígitos que no se pudo leer como fecha → avisar (probable columna de asistencia).
    if (/\d/.test(key)) unreadableDateColumns.push(label);
  });

  if (fieldCol.name === undefined) {
    throw new RosterFormatError('La planilla no tiene la columna "Jugador" en la fila 1 de la primera hoja.');
  }

  const rows: RosterRow[] = [];
  const invalidNames: RosterParseWarnings['invalidNames'] = [];
  const seen = new Set<string>();
  const duplicateNames = new Set<string>();

  for (let r = 1; r < grid.length; r++) {
    const raw = grid[r] as unknown[];
    const nameCell = raw[fieldCol.name];
    if (nameCell === '' || nameCell == null) continue;
    if (typeof nameCell === 'number' || nameCell instanceof Date) {
      invalidNames.push({ row: r + 1, value: cellText((formatted[r] as unknown[])[fieldCol.name]) || String(nameCell), reason: 'No es un nombre (la planilla lo guardó como número o fecha).' });
      continue;
    }
    const name = String(nameCell).trim();
    if (!name) continue;
    const lower = name.toLowerCase();
    if (seen.has(lower)) { duplicateNames.add(name); continue; }
    seen.add(lower);

    const data: Record<string, unknown> = {};
    const numField = (f: FieldKey) => { const c = fieldCol[f]; const v = c === undefined ? undefined : num(raw[c]); if (v !== undefined) data[f] = v; };
    numField('resonance'); numField('armor'); numField('armorPenetration'); numField('power'); numField('resistance');
    if (fieldCol.currentClass !== undefined) { const cls = resolveClass(raw[fieldCol.currentClass]); if (cls) data.currentClass = cls; }
    if (fieldCol.whatsapp !== undefined) { const wa = cellText(raw[fieldCol.whatsapp]); if (wa) data.whatsapp = wa; }

    const attendedDates = dateColumns.filter(dc => Number(raw[dc.col]) === 1).map(dc => dc.date);
    rows.push({ row: r + 1, name, data, attendedDates });
  }

  return {
    rows,
    dateColumns: dateColumns.map(({ header: h, date }) => ({ header: h, date })),
    warnings: { unreadableDateColumns, invalidNames, duplicateNames: [...duplicateNames] },
  };
}

// ── Asistencia ───────────────────────────────────────────────────────────────

type SwRef = { _id: unknown; date: Date };

/** Fecha 'YYYY-MM-DD' → Guerra Sombría del clan ese día (o null). Una sola consulta. */
export async function findWarsByDate(dates: string[], clanId: unknown): Promise<Map<string, SwRef | null>> {
  const map = new Map<string, SwRef | null>();
  const days = [...new Set(dates)].sort();
  if (!days.length) return map;
  const sws = await ShadowWar.find({
    clan: clanId,
    date: { $gte: new Date(days[0] + 'T00:00:00.000Z'), $lte: new Date(days[days.length - 1] + 'T23:59:59.999Z') },
  }).select('_id date').lean();
  const byDay = new Map<string, SwRef>();
  for (const sw of sws) {
    const key = new Date(sw.date).toISOString().slice(0, 10);
    if (!byDay.has(key)) byDay.set(key, sw as SwRef);
  }
  for (const d of days) map.set(d, byDay.get(d) ?? null);
  return map;
}

/** Fechas con columna en la planilla pero sin Guerra Sombría registrada (no se puede marcar). */
export function datesWithoutWar(parsed: RosterParseResult, wars: Map<string, SwRef | null>): string[] {
  return parsed.dateColumns.filter(dc => !wars.get(dc.date)).map(dc => dc.header);
}

/** Marca asistencia (attended=true) en las Guerras Sombrías de las fechas indicadas. */
export async function upsertAttendance(
  attendedDates: string[],
  characterId: unknown,
  clanId: unknown,
  wars: Map<string, SwRef | null>,
): Promise<void> {
  const ops = [];
  for (const d of attendedDates) {
    const sw = wars.get(d);
    if (!sw) continue;
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
