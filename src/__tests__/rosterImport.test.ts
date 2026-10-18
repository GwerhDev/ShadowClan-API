import * as XLSX from 'xlsx';

const bulkWrite = jest.fn(async () => ({}));
jest.mock('../models/Attendance', () => ({ __esModule: true, default: { bulkWrite: (...a: unknown[]) => (bulkWrite as any)(...a) } }));

import { parseDateCol, parseDateHeader, parseRosterFile, upsertAttendance, resolveClass, num, RosterFormatError } from '../helpers/rosterImport';

const now = new Date(Date.UTC(2026, 9, 18)); // 18-oct-2026

/** Arma un .xlsx en memoria a partir de filas (la primera es el encabezado). */
function xlsx(rows: unknown[][]): Buffer {
  const ws = XLSX.utils.aoa_to_sheet(rows);
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, 'Listado');
  return XLSX.write(wb, { type: 'buffer', bookType: 'xlsx' }) as Buffer;
}

describe('parseDateHeader', () => {
  it('acepta meses en español e inglés, abreviados, "sept" y completos', () => {
    expect(parseDateHeader('12dic', now)).toBe('2025-12-12');      // futuro → año anterior
    expect(parseDateHeader('01Aug', now)).toBe('2026-08-01');
    expect(parseDateHeader('3sept', now)).toBe('2026-09-03');
    expect(parseDateHeader('15 ago', now)).toBe('2026-08-15');
    expect(parseDateHeader('28-May', now)).toBe('2026-05-28');
    expect(parseDateHeader('10 Octubre 2025', now)).toBe('2025-10-10');
    expect(parseDateHeader('28/05', now)).toBe('2026-05-28');
  });

  it('usa la fecha exacta de una celda de fecha real (número de serie)', () => {
    expect(parseDateHeader(46235, now)).toBe('2026-08-01');
  });

  it('rechaza lo que no es fecha', () => {
    expect(parseDateHeader('Jugador', now)).toBeNull();
    expect(parseDateHeader('Asist', now)).toBeNull();
    expect(parseDateHeader('40ene', now)).toBeNull();
    expect(parseDateHeader('31feb', now)).toBeNull();
    expect(parseDateHeader(12, now)).toBeNull();
  });

  it('compatibilidad: parseDateCol sigue funcionando', () => {
    const jan5 = new Date(Date.UTC(2027, 0, 5));
    expect(parseDateCol('3ene', jan5)).toBe('2027-01-03');
    expect(parseDateCol('28dic', jan5)).toBe('2026-12-28');
  });
});

describe('parseRosterFile', () => {
  it('lee encabezados sin importar mayúsculas/tildes y marca la asistencia con 1', () => {
    const buf = xlsx([
      ['Rank', 'JUGADOR', 'Armadura', 'Penetración', 'Potencia', 'Resistencia', 'Resonancia', 'Clase', 'Whatsapp', '01Aug', '3sept', 46298, 'Asist'],
      [1, 'Ajax', 3828, 4578, 3284, 3736, 3936, 'Conjurador', '@x', 1, '', 1, 5],
      [2, 'Anle', 2976, '', 3329, 3149, 1182, 'Arcanista', '', '', 1, '', 1],
    ]);
    const r = parseRosterFile(buf, now);
    expect(r.dateColumns.map(d => d.date)).toEqual(['2026-08-01', '2026-09-03', '2026-10-03']);
    expect(r.rows).toHaveLength(2);
    expect(r.rows[0]).toMatchObject({ name: 'Ajax', data: { armorPenetration: 4578, currentClass: 'warlock', whatsapp: '@x' }, attendedDates: ['2026-08-01', '2026-10-03'] });
    expect(r.rows[1].data).not.toHaveProperty('armorPenetration'); // celda vacía no pisa el valor
    expect(r.rows[1].attendedDates).toEqual(['2026-09-03']);
    expect(r.warnings.unreadableDateColumns).toEqual([]);
  });

  it('omite nombres que la planilla convirtió en fecha/número y avisa', () => {
    const buf = xlsx([['Jugador', 'Resonancia'], [46302, ''], ['Ajax', 10], ['ajax', 20]]);
    const r = parseRosterFile(buf, now);
    expect(r.rows.map(x => x.name)).toEqual(['Ajax']);
    expect(r.warnings.invalidNames).toHaveLength(1);
    expect(r.warnings.duplicateNames).toEqual(['ajax']);
  });

  it('avisa columnas que parecen fecha pero no se entienden', () => {
    const r = parseRosterFile(xlsx([['Jugador', '12xyz'], ['Ajax', 1]]), now);
    expect(r.warnings.unreadableDateColumns).toEqual(['12xyz']);
  });

  it('sin columna Jugador → error de formato claro', () => {
    expect(() => parseRosterFile(xlsx([['Nombre del clan'], ['Spartans']]), now)).toThrow(RosterFormatError);
  });
});

describe('upsertAttendance', () => {
  beforeEach(() => bulkWrite.mockClear());

  it('solo agrega asistencias (attended=true); nunca borra ni desmarca', async () => {
    const wars = new Map<string, { _id: unknown; date: Date } | null>([
      ['2026-08-01', { _id: 'sw1', date: new Date('2026-08-01T12:00:00Z') }],
      ['2026-09-03', null], // sin Guerra Sombría registrada → se ignora
    ]);
    await upsertAttendance(['2026-08-01', '2026-09-03'], 'c1', 'clan1', wars);
    expect(bulkWrite).toHaveBeenCalledTimes(1);
    const ops = (bulkWrite.mock.calls[0] as unknown as [any[]])[0];
    expect(ops).toHaveLength(1);
    expect(ops[0]).toHaveProperty('updateOne');
    expect(ops[0].updateOne.update.$set.attended).toBe(true);
    expect(ops.some((o: any) => o.deleteOne || o.deleteMany || o.updateOne?.update?.$set?.attended === false)).toBe(false);
  });

  it('sin fechas marcadas no escribe nada', async () => {
    await upsertAttendance([], 'c1', 'clan1', new Map());
    expect(bulkWrite).not.toHaveBeenCalled();
  });
});

describe('resolveClass / num', () => {
  it('maps spanish class names and keeps system values', () => {
    expect(resolveClass('Arcanista')).toBe('wizard');
    expect(resolveClass('wizard')).toBe('wizard');
    expect(resolveClass('foo')).toBeUndefined();
  });

  it('parses numbers and ignores empty cells', () => {
    expect(num('12')).toBe(12);
    expect(num('')).toBeUndefined();
    expect(num('abc')).toBeUndefined();
  });
});
