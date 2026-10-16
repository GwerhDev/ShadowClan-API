import type { ICharacter } from '../types';

export function calcScore(c: Pick<ICharacter, 'resonance' | 'armor' | 'armorPenetration' | 'power' | 'resistance'>): number {
  return (c.resonance ?? 0) + (c.armor ?? 0) + (c.armorPenetration ?? 0) + (c.power ?? 0) + (c.resistance ?? 0);
}

type Stats = Pick<ICharacter, 'resonance' | 'armor' | 'armorPenetration' | 'power' | 'resistance'>;
const STAT_KEYS = ['resonance', 'armor', 'armorPenetration', 'power', 'resistance'] as const;

/**
 * Puntaje resultante de aplicar `update` sobre `existing`: cada stat toma el valor
 * del update si viene definido, si no el actual, si no 0.
 */
export function mergedScore(update: Record<string, unknown>, existing?: Partial<Stats> | null): number {
  const merged = {} as Stats;
  for (const k of STAT_KEYS) {
    const v = update[k];
    merged[k] = v !== undefined && v !== null && v !== '' ? Number(v) || 0 : (existing?.[k] ?? 0);
  }
  return calcScore(merged);
}
