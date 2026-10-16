import { startOfLocalDay } from '../helpers/autoComplete';

describe('startOfLocalDay', () => {
  it('returns local midnight (UTC-3) as a UTC instant', () => {
    // 16-oct 10:00 UTC = 16-oct 07:00 local → medianoche local 16-oct = 16-oct 03:00 UTC
    expect(startOfLocalDay(new Date('2026-10-16T10:00:00Z'), -3).toISOString()).toBe('2026-10-16T03:00:00.000Z');
  });

  it('handles the hours after UTC midnight that are still the previous local day', () => {
    // 16-oct 01:00 UTC = 15-oct 22:00 local → medianoche local 15-oct = 15-oct 03:00 UTC
    expect(startOfLocalDay(new Date('2026-10-16T01:00:00Z'), -3).toISOString()).toBe('2026-10-15T03:00:00.000Z');
  });

  it('a Shadow War stored for a day is "past" only once that local day ended', () => {
    const swDate = new Date('2026-10-15T12:00:00Z'); // guardada para el 15-oct
    expect(swDate < startOfLocalDay(new Date('2026-10-15T23:00:00Z'), -3)).toBe(false); // 15-oct 20:00 local
    expect(swDate < startOfLocalDay(new Date('2026-10-16T03:30:00Z'), -3)).toBe(true);  // 16-oct 00:30 local
  });
});
