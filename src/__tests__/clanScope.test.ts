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
