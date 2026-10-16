import type { Request } from 'express';
import User from '../models/User';
import { decodeToken } from '../integrations/jwt';
import { status } from '../misc/consts-user-model';
import type { IUser } from '../types';

export async function getUser(req: Request): Promise<IUser | null> {
  const token =
    (req.cookies as Record<string, string | undefined>)['u_tkn'] ??
    req.headers.authorization?.split(' ')[1];

  if (!token) return null;

  try {
    const decoded = await decodeToken(token);
    const user = await User.findById(decoded.data.id);
    return user && user.status === status.active ? user : null;
  } catch {
    return null;
  }
}
