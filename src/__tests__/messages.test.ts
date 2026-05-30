import { message } from '../messages';

describe('Messages', () => {
  it('has admin.permissionDenied', () => {
    expect(typeof message.admin.permissionDenied).toBe('string');
  });

  it('has user.unauthorized', () => {
    expect(typeof message.user.unauthorized).toBe('string');
  });

  it('has character CRUD messages', () => {
    expect(message.character.create.success).toBeDefined();
    expect(message.character.update.success).toBeDefined();
    expect(message.character.delete.success).toBeDefined();
  });

  it('has task messages', () => {
    expect(typeof message.task.created).toBe('string');
    expect(typeof message.task.deleted).toBe('string');
    expect(typeof message.task.updated).toBe('string');
  });
});
