import jwt from 'jsonwebtoken';
import type { JwtPayload } from '../types';

function secret(): string {
  return process.env.PRIVATE_SECRET ?? '';
}

export async function createToken(data: { id: string }, days: number): Promise<string> {
  const payload = { data, exp: Math.floor(Date.now() / 1000) + days * 86_400 };
  return jwt.sign(payload, secret());
}

export async function decodeToken(token: string): Promise<JwtPayload> {
  const decoded = jwt.verify(token, secret());
  if (decoded instanceof Error) throw decoded;
  return decoded as JwtPayload;
}
