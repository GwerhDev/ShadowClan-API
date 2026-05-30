// Config constants are derived from process.env — test env vars directly
// (importing config in tests is fragile due to module caching order)
describe('Config env vars (set by setup.ts)', () => {
  it('PORT is defined and numeric', () => {
    expect(process.env.PORT).toBeDefined();
    expect(isNaN(parseInt(process.env.PORT ?? '', 10))).toBe(false);
  });

  it('PRIVATE_SECRET is set', () => {
    expect(process.env.PRIVATE_SECRET).toBeTruthy();
  });

  it('MONGODB_STRING is set', () => {
    expect(process.env.MONGODB_STRING).toBeTruthy();
  });

  it('BNET_CLIENT is set', () => {
    expect(process.env.BNET_CLIENT).toBeTruthy();
  });
});
