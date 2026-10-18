import { meetsRules } from '../helpers/raffle';
import { raffleCriteria, raffleDraw, prizeCreate } from '../validation/schemas';

const stats = (sw: [number, number], vigil: [number, number]) => ({
  shadow_war:      { attended: sw[0], total: sw[1], percentage: sw[1] ? Math.round((sw[0] / sw[1]) * 100) : 0 },
  vigil_of_blades: { attended: vigil[0], total: vigil[1], percentage: vigil[1] ? Math.round((vigil[0] / vigil[1]) * 100) : 0 },
});

describe('meetsRules', () => {
  it('sin reglas, todos son elegibles', () => {
    expect(meetsRules(stats([0, 4], [0, 0]), [])).toBe(true);
  });

  it('modo cantidad: mínimo de asistencias', () => {
    const rules = [{ activity: 'shadow_war' as const, mode: 'count' as const, min: 3 }];
    expect(meetsRules(stats([3, 8], [0, 0]), rules)).toBe(true);
    expect(meetsRules(stats([2, 8], [0, 0]), rules)).toBe(false);
  });

  it('modo porcentaje: mínimo % de las instancias del período', () => {
    const rules = [{ activity: 'vigil_of_blades' as const, mode: 'percent' as const, min: 50 }];
    expect(meetsRules(stats([0, 0], [1, 2]), rules)).toBe(true);
    expect(meetsRules(stats([0, 0], [1, 3]), rules)).toBe(false);
    // Sin instancias en el período: 0% → no cumple un mínimo mayor a 0.
    expect(meetsRules(stats([0, 0], [0, 0]), rules)).toBe(false);
  });

  it('varias reglas: deben cumplirse todas', () => {
    const rules = [
      { activity: 'shadow_war' as const, mode: 'count' as const, min: 2 },
      { activity: 'vigil_of_blades' as const, mode: 'percent' as const, min: 100 },
    ];
    expect(meetsRules(stats([2, 4], [2, 2]), rules)).toBe(true);
    expect(meetsRules(stats([2, 4], [1, 2]), rules)).toBe(false);
  });
});

describe('validación de sorteos', () => {
  it('ciclo requiere cycleId', () => {
    expect(() => raffleCriteria.parse({ range: 'cycle', rules: [] })).toThrow();
    expect(raffleCriteria.parse({ range: '30', rules: [] }).range).toBe('30');
  });

  it('porcentaje no puede superar 100 y una regla por actividad', () => {
    expect(() => raffleCriteria.parse({ range: '60', rules: [{ activity: 'shadow_war', mode: 'percent', min: 120 }] })).toThrow();
    expect(() => raffleCriteria.parse({
      range: '60',
      rules: [{ activity: 'shadow_war', mode: 'count', min: 1 }, { activity: 'shadow_war', mode: 'percent', min: 50 }],
    })).toThrow();
  });

  it('el sorteo requiere al menos un participante y un premio', () => {
    const base = { characterId: 'a'.repeat(24), prizeIds: ['b'.repeat(24)], criteria: { range: '90', rules: [] } };
    expect(() => raffleDraw.parse({ ...base, participantIds: [] })).toThrow();
    expect(() => raffleDraw.parse({ ...base, prizeIds: [], participantIds: ['c'.repeat(24)] })).toThrow();
    const ok = raffleDraw.parse({ ...base, participantIds: ['c'.repeat(24)] });
    expect(ok.participantIds).toHaveLength(1);
    expect(ok.criteria.includeStaff).toBe(false); // líder/oficiales fuera por defecto
  });

  it('no puede haber más premios que participantes (un premio por persona)', () => {
    const base = { characterId: 'a'.repeat(24), criteria: { range: '30', rules: [] } };
    // Mismo premio dos veces (dos unidades) con un solo participante → inválido.
    expect(() => raffleDraw.parse({ ...base, prizeIds: ['b'.repeat(24), 'b'.repeat(24)], participantIds: ['c'.repeat(24)] })).toThrow();
    expect(raffleDraw.parse({ ...base, prizeIds: ['b'.repeat(24), 'b'.repeat(24)], participantIds: ['c'.repeat(24), 'd'.repeat(24)] }).prizeIds).toHaveLength(2);
  });

  it('premio requiere nombre', () => {
    expect(() => prizeCreate.parse({ name: '  ' })).toThrow();
    expect(prizeCreate.parse({ name: 'Bendición', description: 'x' }).name).toBe('Bendición');
  });
});
