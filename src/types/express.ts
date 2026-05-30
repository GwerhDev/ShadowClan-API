import { Request } from 'express';
import { IUser } from './models';

export interface AuthRequest extends Request {
  user?: IUser;
}

export interface JwtPayload {
  data: { id: string };
  exp: number;
  iat?: number;
}

export interface BnetProfile {
  battlenetId: string;
  battletag: string;
  provider: string;
}

export interface ApiResponse<T = unknown> {
  message?: string;
  error?: string;
  data?: T;
}
