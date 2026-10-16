import { isSystemAdmin } from '../helpers/clanScope';
import type { IUser } from '../types';
import { Types } from 'mongoose';

function makeUser(role: IUser['role']): IUser {
  return {
    _id: new Types.ObjectId(),
    battlenetId: 'test',
    battletag:   'Test#1234',
    provider:    'bnet',
    status:      'active',
    role,
    character:   [],
    createdAt:   new Date(),
    updatedAt:   new Date(),
  } as unknown as IUser;
}

describe('isSystemAdmin', () => {
  it('returns true for admin', () => {
    expect(isSystemAdmin(makeUser('admin'))).toBe(true);
  });

  it('returns true for super_admin', () => {
    expect(isSystemAdmin(makeUser('super_admin'))).toBe(true);
  });

  it('returns false for leader', () => {
    expect(isSystemAdmin(makeUser('leader'))).toBe(false);
  });

  it('returns false for officer', () => {
    expect(isSystemAdmin(makeUser('officer'))).toBe(false);
  });

  it('returns false for user', () => {
    expect(isSystemAdmin(makeUser('user'))).toBe(false);
  });

  it('returns false for walker', () => {
    expect(isSystemAdmin(makeUser('walker'))).toBe(false);
  });
});

import { ownsCharacter, sameId, escapeRegex } from '../helpers/clanScope';
import { ownerFilter, parseDate } from '../helpers/ownerScope';

describe('ownsCharacter', () => {
  const charA = new Types.ObjectId();
  const charB = new Types.ObjectId();
  const user = { ...makeUser('user'), character: [charA] } as unknown as IUser;

  it('accepts a character of the user (string or ObjectId)', () => {
    expect(ownsCharacter(user, String(charA))).toBe(true);
    expect(ownsCharacter(user, charA)).toBe(true);
  });

  it('rejects a foreign character', () => {
    expect(ownsCharacter(user, String(charB))).toBe(false);
  });

  it('rejects empty ids', () => {
    expect(ownsCharacter(user, undefined)).toBe(false);
    expect(ownsCharacter(user, '')).toBe(false);
  });
});

describe('sameId', () => {
  it('compares ObjectIds, strings and populated docs', () => {
    const id = new Types.ObjectId();
    expect(sameId(id, String(id))).toBe(true);
    expect(sameId({ _id: id }, id)).toBe(true);
    expect(sameId(id, new Types.ObjectId())).toBe(false);
  });

  it('is false for null/undefined', () => {
    expect(sameId(null, null)).toBe(false);
    expect(sameId(undefined, 'x')).toBe(false);
  });
});

describe('escapeRegex', () => {
  it('escapes regex metacharacters', () => {
    const raw = 'a.b*c(d)[e]';
    expect(new RegExp(`^${escapeRegex(raw)}$`).test(raw)).toBe(true);
    expect(new RegExp(`^${escapeRegex('a.b')}$`).test('axb')).toBe(false);
  });
});

describe('ownerFilter', () => {
  const charA = new Types.ObjectId();
  const user = { ...makeUser('user'), character: [charA] } as unknown as IUser;

  it('scopes to own character', () => {
    expect(ownerFilter(user, String(charA))).toEqual({ character: String(charA) });
  });

  it('denies a foreign character', () => {
    expect(ownerFilter(user, String(new Types.ObjectId()))).toBeNull();
  });

  it('falls back to the user when no character is given', () => {
    expect(ownerFilter(user, undefined)).toEqual({ user: user._id });
  });
});

describe('parseDate', () => {
  it('parses valid dates and rejects invalid ones', () => {
    expect(parseDate('2026-10-15')).toBeInstanceOf(Date);
    expect(parseDate('not-a-date')).toBeNull();
    expect(parseDate(undefined)).toBeNull();
  });
});
