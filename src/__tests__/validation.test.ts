import { ZodError } from 'zod';
import * as V from '../validation/schemas';
import { mergedScore } from '../helpers/score';
import { applyResponse } from '../helpers/activity';

const id1 = '64b7f0c2a1b2c3d4e5f60718';
const id2 = '64b7f0c2a1b2c3d4e5f60719';

describe('shadowWarPatch', () => {
  it('normalizes populated slots to IDs and keeps nulls', () => {
    const out = V.shadowWarPatch.parse({
      battle: { exalted: [{ group1: { character: [{ _id: id1, name: 'A' }, null] }, group2: { character: [id2] } }] },
    });
    expect(out.battle!.exalted[0].group1.character).toEqual([id1, null]);
    expect(out.battle!.exalted[0].group2.character).toEqual([id2]);
    expect(out.battle!.proud).toEqual([]);
  });

  it('accepts a populated enemyClan and maps "" to null', () => {
    expect(V.shadowWarPatch.parse({ enemyClan: { _id: id1, name: 'X' } }).enemyClan).toBe(id1);
    expect(V.shadowWarPatch.parse({ enemyClan: '' }).enemyClan).toBeNull();
    expect(V.shadowWarPatch.parse({}).enemyClan).toBeUndefined();
  });

  it('rejects invalid results and ids', () => {
    expect(() => V.shadowWarPatch.parse({ result: 'win' })).toThrow(ZodError);
    expect(() => V.shadowWarPatch.parse({ battle: { exalted: [{ group1: { character: ['nope'] } }] } })).toThrow(ZodError);
  });
});

describe('other schemas', () => {
  it('cycleCreate requires a valid activityType and date', () => {
    expect(() => V.cycleCreate.parse({ startDate: '2026-01-01', activityType: 'other' })).toThrow(ZodError);
    expect(V.cycleCreate.parse({ startDate: '2026-01-01', activityType: 'shadow', endDate: '' }).endDate).toBeUndefined();
  });

  it('clanPostPatch limits content length', () => {
    expect(() => V.clanPostPatch.parse({ content: 'x'.repeat(1001) })).toThrow(ZodError);
  });

  it('memberPatch coerces numeric stats', () => {
    expect(V.memberPatch.parse({ resonance: '120' }).resonance).toBe(120);
    expect(() => V.memberPatch.parse({ armor: -1 })).toThrow(ZodError);
  });
});

describe('mergedScore', () => {
  it('uses update values over existing ones', () => {
    expect(mergedScore({ resonance: 10 }, { resonance: 5, armor: 3 })).toBe(13);
  });

  it('ignores empty values and defaults to 0', () => {
    expect(mergedScore({ resonance: '', power: '7' })).toBe(7);
  });
});

describe('applyResponse', () => {
  const doc = () => ({ confirmed: [id1] as string[], declined: [] as string[] });

  it('moves a character between lists without duplicates', () => {
    const d = doc();
    applyResponse(d, id1, 'decline');
    expect(d).toEqual({ confirmed: [], declined: [id1] });
    applyResponse(d, id1, 'confirm');
    applyResponse(d, id1, 'confirm');
    expect(d).toEqual({ confirmed: [id1], declined: [] });
  });

  it('pending clears both lists', () => {
    const d = doc();
    applyResponse(d, id1, 'pending');
    expect(d).toEqual({ confirmed: [], declined: [] });
  });
});
