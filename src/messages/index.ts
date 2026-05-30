interface CrudMessages {
  success: string;
  failure: string;
  error: string;
}

interface Messages {
  character: Record<'create' | 'update' | 'delete', CrudMessages>;
  crest:     Record<'create' | 'update' | 'delete', CrudMessages>;
  task:      Record<'created' | 'deleted' | 'updated', string>;
  admin:     Record<string, string | CrudMessages>;
  login:     Record<'success' | 'failure' | 'existinguser' | 'error', string>;
  signup:    Record<'success' | 'failure' | 'existinguser' | 'error', string>;
  user:      Record<'error' | 'existing' | 'notfound' | 'unauthorized', string>;
  member:    Record<string, string | CrudMessages>;
}

export const message: Messages = {
  character: {
    create: { success: 'Character created successfully', failure: 'Failed to create character',  error: 'Error creating character'  },
    update: { success: 'Character updated successfully', failure: 'Character not found',         error: 'Error updating character'  },
    delete: { success: 'Character deleted successfully', failure: 'Character not found',         error: 'Error deleting character'  },
  },
  crest: {
    create: { success: 'Crest created successfully', failure: 'Failed to create crest', error: 'Error creating crest' },
    update: { success: 'Crest updated successfully', failure: 'Crest not found',        error: 'Error updating crest' },
    delete: { success: 'Crest deleted successfully', failure: 'Crest not found',        error: 'Error deleting crest' },
  },
  task: {
    created: 'Task created successfully',
    deleted: 'Task deleted successfully',
    updated: 'Task updated successfully',
  },
  admin: {
    permissionDenied: 'Permission denied',
    createuser: { success: 'User created successfully', failure: 'Failed to create user',  error: 'Error creating user'  },
    updateuser: { success: 'User updated successfully', failure: 'User not found',          error: 'Error updating user'  },
    deleteuser: { success: 'User deleted successfully', failure: 'User not found',          error: 'Error deleting user'  },
  },
  login: {
    success:      'Login successfull',
    failure:      'Login failed',
    existinguser: 'User already exists',
    error:        'Error logging in',
  },
  signup: {
    success:      'Signup successfull',
    failure:      'Signup failed',
    existinguser: 'User already exists',
    error:        'Error signing up',
  },
  user: {
    error:        'Error',
    existing:     'User already exists',
    notfound:     'User not found',
    unauthorized: 'Unauthorized',
  },
  member: {
    create:   { success: 'Member created successfully', failure: 'Failed to create member', error: 'Error creating member' },
    update:   { success: 'Member updated successfully', failure: 'Member not found',        error: 'Error updating member' },
    delete:   { success: 'Member deleted successfully', failure: 'Member not found',        error: 'Error deleting member' },
    notfound: 'Member not found',
    error:    'Error processing member request',
  },
};
