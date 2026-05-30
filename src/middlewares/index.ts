import type { RequestHandler, Request, Response, NextFunction } from 'express';
import User from '../models/User';
import { message } from '../messages';
import { decodeToken } from '../integrations/jwt';
import type { UserRole, IUser } from '../types';

declare global {
  namespace Express {
    interface Request {
      user?: IUser;
    }
  }
}

export function authorizeRoles(allowedRoles: UserRole[]): RequestHandler {
  return async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const token = req.cookies['u_tkn'] as string | undefined
        ?? req.headers.authorization?.split(' ')[1];

      if (!token) {
        res.status(401).json({ message: message.admin.permissionDenied });
        return;
      }

      const decoded = await decodeToken(token);
      const user = await User.findById(decoded.data.id);

      if (!user || !allowedRoles.includes(user.role)) {
        res.status(403).json({ message: message.admin.permissionDenied });
        return;
      }

      req.user = user;
      next();
    } catch {
      res.status(500).json({ error: message.user.error });
    }
  };
}
