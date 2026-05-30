import type { CharacterStatus, ClanStatus } from '../types';

export const characterConsts = {
  status: {
    pending:   'pending'   as CharacterStatus,
    claimed:   'claimed'   as CharacterStatus,
    unclaimed: 'unclaimed' as CharacterStatus,
  },
} as const;

export const clanConsts = {
  status: {
    pending:   'pending'   as ClanStatus,
    claimed:   'claimed'   as ClanStatus,
    unclaimed: 'unclaimed' as ClanStatus,
  },
} as const;
