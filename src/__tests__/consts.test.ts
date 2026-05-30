import { roles, status, methods } from '../misc/consts-user-model';

describe('User model constants', () => {
  describe('roles', () => {
    it('defines all expected roles', () => {
      expect(roles.superAdmin).toBe('super_admin');
      expect(roles.admin).toBe('admin');
      expect(roles.leader).toBe('leader');
      expect(roles.officer).toBe('officer');
      expect(roles.user).toBe('user');
      expect(roles.walker).toBe('walker');
    });

    it('has 6 roles defined', () => {
      expect(Object.keys(roles)).toHaveLength(6);
    });
  });

  describe('status', () => {
    it('defines all user statuses', () => {
      expect(status.active).toBe('active');
      expect(status.pending).toBe('pending');
      expect(status.inactive).toBe('inactive');
    });
  });

  describe('methods', () => {
    it('defines provider methods', () => {
      expect(methods.bnet).toBe('bnet');
      expect(methods.inner).toBe('inner');
      expect(methods.adminManagement).toBe('admin-management');
    });
  });
});
