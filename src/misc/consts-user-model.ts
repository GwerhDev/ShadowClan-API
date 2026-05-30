import type { UserRole, UserStatus, UserProvider } from '../types';

export const status: Record<string, UserStatus> = {
  active:   'active',
  pending:  'pending',
  inactive: 'inactive',
} as const;

export const roles: Record<string, UserRole> = {
  superAdmin: 'super_admin',
  admin:      'admin',
  leader:     'leader',
  officer:    'officer',
  user:       'user',
  walker:     'walker',
} as const;

export const methods: Record<string, UserProvider> = {
  bnet:             'bnet',
  inner:            'inner',
  adminManagement:  'admin-management',
} as const;
