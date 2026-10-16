import crypto from 'crypto';
import type { Request, Response, CookieOptions } from 'express';
import type { Types } from 'mongoose';
import Session from '../models/Session';
import { createAccessToken } from '../integrations/jwt';

// Sesiones con refresh token:
//  - u_tkn  : access token (JWT) de vida corta; lo leen los middlewares en cada request.
//  - u_rtkn : refresh token opaco (httpOnly, solo /auth). Rota en cada uso y mantiene viva
//             la sesión del dispositivo hasta SESSION_DAYS desde la última conexión.

export const ACCESS_TOKEN_MINUTES = 15;
export const SESSION_DAYS = 3;
const ROTATION_GRACE_MS = 30_000;

const ACCESS_COOKIE  = 'u_tkn';
const REFRESH_COOKIE = 'u_rtkn';
const REFRESH_PATH   = '/auth';

const isProd = () => process.env.NODE_ENV === 'production';

function baseCookie(): CookieOptions {
  return isProd()
    ? { httpOnly: true, secure: true, sameSite: 'none', domain: '.shadowclan.cl' }
    : { httpOnly: true, secure: false, sameSite: 'lax' };
}

const sessionMs = () => SESSION_DAYS * 86_400_000;
const hash = (token: string) => crypto.createHash('sha256').update(token).digest('hex');
const newRefreshToken = () => crypto.randomBytes(48).toString('base64url');

async function setAccessCookie(res: Response, userId: string): Promise<void> {
  const token = await createAccessToken(userId, ACCESS_TOKEN_MINUTES);
  res.cookie(ACCESS_COOKIE, token, { ...baseCookie(), path: '/', maxAge: ACCESS_TOKEN_MINUTES * 60_000 });
}

function setRefreshCookie(res: Response, token: string): void {
  res.cookie(REFRESH_COOKIE, token, { ...baseCookie(), path: REFRESH_PATH, maxAge: sessionMs() });
}

export function clearAuthCookies(res: Response): void {
  res.clearCookie(ACCESS_COOKIE,  { ...baseCookie(), path: '/' });
  res.clearCookie(REFRESH_COOKIE, { ...baseCookie(), path: REFRESH_PATH });
}

const readRefreshCookie = (req: Request): string | undefined =>
  (req.cookies as Record<string, string | undefined> | undefined)?.[REFRESH_COOKIE];

/** Inicio de sesión: crea la sesión del dispositivo y setea ambas cookies. */
export async function startSession(req: Request, res: Response, userId: Types.ObjectId | string): Promise<void> {
  const token = newRefreshToken();
  const now = new Date();
  await Session.create({
    user: userId,
    tokenHash: hash(token),
    expiresAt: new Date(now.getTime() + sessionMs()),
    lastUsedAt: now,
    userAgent: String(req.headers['user-agent'] ?? '').slice(0, 300),
    ip: req.ip,
  });
  await setAccessCookie(res, String(userId));
  setRefreshCookie(res, token);
}

export type RefreshResult =
  | { ok: true; userId: string }
  | { ok: false; reason: 'missing' | 'invalid' | 'expired' | 'reused' };

/**
 * Renueva el access token a partir del refresh token y rota este último.
 * `isUserActive` permite cortar la sesión si el usuario fue desactivado.
 */
export async function refreshSession(
  req: Request,
  res: Response,
  isUserActive: (userId: string) => Promise<boolean>,
): Promise<RefreshResult> {
  const raw = readRefreshCookie(req);
  if (!raw) return { ok: false, reason: 'missing' };
  const h = hash(raw);
  const now = new Date();

  const session = await Session.findOne({ tokenHash: h });
  if (!session) {
    // ¿Es el token anterior de alguna sesión?
    const prev = await Session.findOne({ prevTokenHash: h });
    if (prev && prev.prevValidUntil && prev.prevValidUntil > now && prev.expiresAt > now) {
      // Refresco concurrente (otra pestaña ya rotó): solo se emite un access token nuevo;
      // la cookie de refresh vigente ya la tiene el navegador.
      if (!(await isUserActive(String(prev.user)))) { await prev.deleteOne(); return { ok: false, reason: 'invalid' }; }
      await setAccessCookie(res, String(prev.user));
      return { ok: true, userId: String(prev.user) };
    }
    if (prev) {
      // Reutilización de un token ya rotado fuera de la ventana de gracia → posible robo.
      await prev.deleteOne();
      return { ok: false, reason: 'reused' };
    }
    return { ok: false, reason: 'invalid' };
  }

  if (session.expiresAt <= now) { await session.deleteOne(); return { ok: false, reason: 'expired' }; }
  if (!(await isUserActive(String(session.user)))) { await session.deleteOne(); return { ok: false, reason: 'invalid' }; }

  const next = newRefreshToken();
  session.prevTokenHash  = session.tokenHash;
  session.prevValidUntil = new Date(now.getTime() + ROTATION_GRACE_MS);
  session.tokenHash      = hash(next);
  session.lastUsedAt     = now;
  session.expiresAt      = new Date(now.getTime() + sessionMs());
  await session.save();

  await setAccessCookie(res, String(session.user));
  setRefreshCookie(res, next);
  return { ok: true, userId: String(session.user) };
}

/** Cierra la sesión del dispositivo actual (si la hay) y limpia las cookies. */
export async function endSession(req: Request, res: Response): Promise<void> {
  const raw = readRefreshCookie(req);
  if (raw) {
    const h = hash(raw);
    await Session.deleteOne({ $or: [{ tokenHash: h }, { prevTokenHash: h }] });
  }
  clearAuthCookies(res);
}

/** Revoca todas las sesiones de un usuario (desactivación, borrado de cuenta). */
export async function revokeUserSessions(userId: Types.ObjectId | string): Promise<void> {
  await Session.deleteMany({ user: userId });
}
