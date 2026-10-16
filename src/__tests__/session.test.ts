// Tests de rotación del refresh token con un modelo Session simulado en memoria.
type Doc = Record<string, any>;
const store: Doc[] = [];

jest.mock('../models/Session', () => {
  const wrap = (d: Doc) => Object.assign(d, {
    save: async () => d,
    deleteOne: async () => { const i = store.indexOf(d); if (i >= 0) store.splice(i, 1); },
  });
  const matches = (d: Doc, q: Doc): boolean => Object.entries(q).every(([k, v]) => {
    if (k === '$or') return (v as Doc[]).some(sub => matches(d, sub));
    return d[k] === v;
  });
  return {
    __esModule: true,
    default: {
      create: async (data: Doc) => { const d = wrap({ ...data }); store.push(d); return d; },
      findOne: async (q: Doc) => store.find(d => matches(d, q)) ?? null,
      deleteOne: async (q: Doc) => { const i = store.findIndex(d => matches(d, q)); if (i >= 0) store.splice(i, 1); },
      deleteMany: async (q: Doc) => { for (let i = store.length - 1; i >= 0; i--) if (matches(store[i], q)) store.splice(i, 1); },
    },
  };
});

import { startSession, refreshSession, endSession, SESSION_DAYS } from '../helpers/session';

function mockRes() {
  const cookies: Record<string, { value: string; opts: Doc }> = {};
  const cleared: string[] = [];
  return {
    cookies, cleared,
    cookie(name: string, value: string, opts: Doc) { cookies[name] = { value, opts }; return this; },
    clearCookie(name: string) { cleared.push(name); return this; },
  } as any;
}
const reqWith = (rtkn?: string) => ({ cookies: rtkn ? { u_rtkn: rtkn } : {}, headers: { 'user-agent': 'jest' }, ip: '127.0.0.1' }) as any;
const active = async () => true;

beforeEach(() => { store.length = 0; });

describe('refresh token sessions', () => {
  it('login sets a short access cookie and a 3-day refresh cookie scoped to /auth', async () => {
    const res = mockRes();
    await startSession(reqWith(), res, 'u1');
    expect(res.cookies.u_tkn.opts.maxAge).toBe(15 * 60_000);
    expect(res.cookies.u_rtkn.opts.path).toBe('/auth');
    expect(res.cookies.u_rtkn.opts.maxAge).toBe(SESSION_DAYS * 86_400_000);
    expect(store).toHaveLength(1);
    expect(store[0].tokenHash).not.toBe(res.cookies.u_rtkn.value); // solo se guarda el hash
  });

  it('refresh rotates the token and slides the expiry', async () => {
    const login = mockRes();
    await startSession(reqWith(), login, 'u1');
    const first = login.cookies.u_rtkn.value;
    const before = store[0].expiresAt.getTime();

    const res = mockRes();
    const r = await refreshSession(reqWith(first), res, active);
    expect(r).toEqual({ ok: true, userId: 'u1' });
    expect(res.cookies.u_rtkn.value).not.toBe(first);
    expect(res.cookies.u_tkn).toBeDefined();
    expect(store[0].expiresAt.getTime()).toBeGreaterThanOrEqual(before);
  });

  it('accepts the previous token inside the grace window without rotating again', async () => {
    const login = mockRes();
    await startSession(reqWith(), login, 'u1');
    const first = login.cookies.u_rtkn.value;
    await refreshSession(reqWith(first), mockRes(), active);

    const res = mockRes();
    const r = await refreshSession(reqWith(first), res, active);
    expect(r.ok).toBe(true);
    expect(res.cookies.u_tkn).toBeDefined();
    expect(res.cookies.u_rtkn).toBeUndefined();
  });

  it('revokes the session when an old token is reused after the grace window', async () => {
    const login = mockRes();
    await startSession(reqWith(), login, 'u1');
    const first = login.cookies.u_rtkn.value;
    await refreshSession(reqWith(first), mockRes(), active);
    store[0].prevValidUntil = new Date(Date.now() - 1000);

    const r = await refreshSession(reqWith(first), mockRes(), active);
    expect(r).toEqual({ ok: false, reason: 'reused' });
    expect(store).toHaveLength(0);
  });

  it('rejects expired sessions, unknown tokens and inactive users', async () => {
    const login = mockRes();
    await startSession(reqWith(), login, 'u1');
    const tok = login.cookies.u_rtkn.value;

    expect(await refreshSession(reqWith('nope'), mockRes(), active)).toEqual({ ok: false, reason: 'invalid' });
    expect(await refreshSession(reqWith(), mockRes(), active)).toEqual({ ok: false, reason: 'missing' });
    expect((await refreshSession(reqWith(tok), mockRes(), async () => false)).ok).toBe(false);
    expect(store).toHaveLength(0);

    const login2 = mockRes();
    await startSession(reqWith(), login2, 'u2');
    store[0].expiresAt = new Date(Date.now() - 1);
    expect(await refreshSession(reqWith(login2.cookies.u_rtkn.value), mockRes(), active)).toEqual({ ok: false, reason: 'expired' });
  });

  it('logout removes the device session and clears both cookies', async () => {
    const login = mockRes();
    await startSession(reqWith(), login, 'u1');
    const res = mockRes();
    await endSession(reqWith(login.cookies.u_rtkn.value), res);
    expect(store).toHaveLength(0);
    expect(res.cleared).toEqual(expect.arrayContaining(['u_tkn', 'u_rtkn']));
  });
});
