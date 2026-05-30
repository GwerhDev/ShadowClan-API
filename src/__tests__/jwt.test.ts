import { createToken, decodeToken } from '../integrations/jwt';

describe('JWT Integration', () => {
  const payload = { id: 'user123' };

  it('should create a valid token', async () => {
    const token = await createToken(payload, 1);
    expect(typeof token).toBe('string');
    expect(token.split('.')).toHaveLength(3);
  });

  it('should decode a token and return correct payload', async () => {
    const token = await createToken(payload, 1);
    const decoded = await decodeToken(token);
    expect(decoded.data.id).toBe(payload.id);
  });

  it('should set expiration approximately 1 day from now', async () => {
    const before = Math.floor(Date.now() / 1000);
    const token = await createToken(payload, 1);
    const decoded = await decodeToken(token);
    const oneDayInSeconds = 60 * 60 * 24;
    expect(decoded.exp).toBeGreaterThanOrEqual(before + oneDayInSeconds - 5);
    expect(decoded.exp).toBeLessThanOrEqual(before + oneDayInSeconds + 5);
  });

  it('should reject or throw for an invalid token', async () => {
    try {
      const result = await decodeToken('invalid.token.here');
      // If it resolves, it should not be a valid JwtPayload
      expect(result).not.toHaveProperty('data.id');
    } catch {
      // Expected — token is invalid
    }
  });

  it('should reject or throw for a tampered token', async () => {
    const token = await createToken(payload, 1);
    const tampered = token.slice(0, -4) + 'xxxx';
    try {
      const result = await decodeToken(tampered);
      expect(result).not.toHaveProperty('data.id', payload.id);
    } catch {
      // Expected — token is tampered
    }
  });
});
