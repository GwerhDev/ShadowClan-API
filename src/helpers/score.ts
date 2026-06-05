import type { ICharacter } from '../types';

export function calcScore(c: Pick<ICharacter, 'resonance' | 'armor' | 'armorPenetration' | 'power' | 'resistance'>): number {
  return (c.resonance ?? 0) + (c.armor ?? 0) + (c.armorPenetration ?? 0) + (c.power ?? 0) + (c.resistance ?? 0);
}
