import { parseDateCol, resolveClass, num } from '../helpers/rosterImport';

describe('parseDateCol', () => {
  const jan5 = new Date(Date.UTC(2027, 0, 5));

  it('uses the current year for past dates', () => {
    expect(parseDateCol('3ene', jan5)).toBe('2027-01-03');
  });

  it('rolls back to the previous year when the date would be in the future', () => {
    expect(parseDateCol('28dic', jan5)).toBe('2026-12-28');
  });

  it('accepts dates within the 7-day future tolerance', () => {
    expect(parseDateCol('10ene', jan5)).toBe('2027-01-10');
  });

  it('rejects non-date columns', () => {
    expect(parseDateCol('Jugador', jan5)).toBeNull();
    expect(parseDateCol('12xyz', jan5)).toBeNull();
    expect(parseDateCol('40ene', jan5)).toBeNull();
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
