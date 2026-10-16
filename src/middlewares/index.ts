import type { RequestHandler, Request, Response, NextFunction } from 'express';
import User from '../models/User';
import { message } from '../messages';
import { decodeToken } from '../integrations/jwt';
import { handleError } from '../helpers/http';
import { status } from '../misc/consts-user-model';
import type { UserRole, IUser } from '../types';

declare global {
  namespace Express {
    interface Request {
      user?: IUser;
    }
  }
}

function readToken(req: Request): string | undefined {
  return (req.cookies?.['u_tkn'] as string | undefined)
    ?? req.headers.authorization?.split(' ')[1];
}

/**
 * Resuelve el usuario autenticado a partir del cookie `u_tkn` (o Bearer).
 * Devuelve null si no hay token, es inválido/expiró, o el usuario no está activo.
 */
async function resolveActiveUser(req: Request): Promise<IUser | null> {
  const token = readToken(req);
  if (!token) return null;
  try {
    const decoded = await decodeToken(token);
    const user = await User.findById(decoded.data.id);
    if (!user || user.status !== status.active) return null;
    return user;
  } catch {
    return null;
  }
}

/** Requiere un usuario autenticado y activo (cualquier rol). */
export const requireAuth: RequestHandler = async (req, res, next) => {
  try {
    const user = await resolveActiveUser(req);
    if (!user) { res.status(401).json({ message: message.user.unauthorized }); return; }
    req.user = user;
    next();
  } catch (err) {
    handleError(res, err, 'requireAuth');
  }
};

export function authorizeRoles(allowedRoles: UserRole[]): RequestHandler {
  return async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const user = await resolveActiveUser(req);
      if (!user) { res.status(401).json({ message: message.user.unauthorized }); return; }
      if (!allowedRoles.includes(user.role)) {
        res.status(403).json({ message: message.admin.permissionDenied });
        return;
      }
      req.user = user;
      next();
    } catch (err) {
      handleError(res, err, 'authorizeRoles');
    }
  };
}
