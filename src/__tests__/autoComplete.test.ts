import { completionCutoff, isPastActivityDate } from '../helpers/autoComplete';

// Zona horaria del clan: UTC-3. Hora de término: 20:00 local = 23:00 UTC.
const at = (iso: string) => new Date(iso);

describe('completionCutoff (20:00 hora local, UTC-3)', () => {
  it('antes de las 20:00 locales, el día de hoy todavía no termina', () => {
    // 16-oct 19:59 local = 22:59 UTC → último día terminado: 15-oct → corte 16-oct 00:00 UTC
    expect(completionCutoff(at('2026-10-16T22:59:00Z'), -3).toISOString()).toBe('2026-10-16T00:00:00.000Z');
  });

  it('desde las 20:00 locales, el día de hoy ya terminó', () => {
    // 16-oct 20:00 local = 23:00 UTC → corte 17-oct 00:00 UTC
    expect(completionCutoff(at('2026-10-16T23:00:00Z'), -3).toISOString()).toBe('2026-10-17T00:00:00.000Z');
  });

  it('después de la medianoche UTC sigue siendo el día local anterior', () => {
    // 17-oct 01:00 UTC = 16-oct 22:00 local → el 16 ya terminó
    expect(completionCutoff(at('2026-10-17T01:00:00Z'), -3).toISOString()).toBe('2026-10-17T00:00:00.000Z');
  });
});

describe('isPastActivityDate', () => {
  it('una guerra del 16-oct se completa recién a las 20:00 locales de ese día', () => {
    expect(isPastActivityDate('2026-10-16T12:00:00Z', at('2026-10-16T22:59:00Z'))).toBe(false); // 19:59 local
    expect(isPastActivityDate('2026-10-16T12:00:00Z', at('2026-10-16T23:00:00Z'))).toBe(true);  // 20:00 local
  });

  it('las instancias guardadas a las 00:00 UTC también respetan su día', () => {
    expect(isPastActivityDate('2026-10-16T00:00:00Z', at('2026-10-16T10:00:00Z'))).toBe(false); // mañana del 16
    expect(isPastActivityDate('2026-10-16T00:00:00Z', at('2026-10-16T23:30:00Z'))).toBe(true);
  });

  it('una fecha futura nunca está vencida', () => {
    expect(isPastActivityDate('2026-10-20T12:00:00Z', at('2026-10-16T23:30:00Z'))).toBe(false);
  });
});

describe('Vigilia de Espadas (término 20:30 local)', () => {
  it('a las 20:15 locales la vigilia del día sigue activa; a las 20:30 ya terminó', () => {
    // 18-oct 20:15 local = 23:15 UTC ; 20:30 local = 23:30 UTC
    expect(isPastActivityDate('2026-10-18T12:00:00Z', at('2026-10-18T23:15:00Z'), 'vigil_of_blades')).toBe(false);
    expect(isPastActivityDate('2026-10-18T12:00:00Z', at('2026-10-18T23:30:00Z'), 'vigil_of_blades')).toBe(true);
  });

  it('a la misma hora una Guerra Sombría (20:00) ya está terminada', () => {
    expect(isPastActivityDate('2026-10-18T12:00:00Z', at('2026-10-18T23:15:00Z'), 'shadow_war')).toBe(true);
  });

  it('completionCutoff respeta los minutos', () => {
    expect(completionCutoff(at('2026-10-18T23:29:00Z'), -3, 20, 30).toISOString()).toBe('2026-10-18T00:00:00.000Z');
    expect(completionCutoff(at('2026-10-18T23:30:00Z'), -3, 20, 30).toISOString()).toBe('2026-10-19T00:00:00.000Z');
  });
});
