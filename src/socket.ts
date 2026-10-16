import { Server } from 'socket.io';
import type { Server as HttpServer } from 'http';
import type { Types } from 'mongoose';

let _io: Server | null = null;

export function init(httpServer: HttpServer, corsOptions: Record<string, unknown>): Server {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  _io = new Server(httpServer as any, { cors: corsOptions } as any);
  return _io;
}

export function getIO(): Server {
  if (!_io) throw new Error('Socket.IO not initialized');
  return _io;
}

/** IDs de los clanes a los que pertenece alguno de los personajes del usuario. */
export async function getUserClanIds(userId: string): Promise<string[]> {
  const User      = (await import('./models/User')).default;
  const Character = (await import('./models/Character')).default;
  const userDoc   = await User.findById(userId).select('character');
  if (!userDoc?.character?.length) return [];
  const chars = await Character.find({ _id: { $in: userDoc.character } }).select('clan');
  return [...new Set(chars.map(c => (c.clan ? String(c.clan) : '')).filter(Boolean))];
}

/**
 * Re-sincroniza las salas `clan:*` de los sockets conectados del dueño de un personaje.
 * Se llama al entrar/salir de un clan para que los eventos de clan lleguen (o dejen
 * de llegar) sin reconectar. Nunca lanza.
 */
export async function syncClanRoomsForCharacter(characterId: Types.ObjectId | string): Promise<void> {
  if (!_io) return;
  try {
    const User  = (await import('./models/User')).default;
    const owner = await User.findOne({ character: characterId }).select('_id');
    if (!owner) return;
    const userId  = String(owner._id);
    const wanted  = new Set((await getUserClanIds(userId)).map(id => `clan:${id}`));
    const sockets = await _io.in(`user:${userId}`).fetchSockets();
    for (const s of sockets) {
      for (const room of s.rooms) if (room.startsWith('clan:') && !wanted.has(room)) s.leave(room);
      for (const room of wanted) if (!s.rooms.has(room)) s.join(room);
    }
  } catch (e) {
    console.warn('syncClanRoomsForCharacter:', (e as Error).message);
  }
}

// ── Emisores seguros: nunca lanzan (un fallo de socket no debe romper la respuesta HTTP) ──

export function emitToUser(userId: unknown, event: string, payload: unknown): void {
  try { if (_io && userId) _io.to(`user:${String(userId)}`).emit(event, payload); }
  catch (e) { console.warn(`emitToUser(${event}):`, (e as Error).message); }
}

export function emitToClan(clanId: unknown, event: string, payload: unknown, exceptUserId?: unknown): void {
  try {
    if (!_io || !clanId) return;
    const room = _io.to(`clan:${String(clanId)}`);
    (exceptUserId ? room.except(`user:${String(exceptUserId)}`) : room).emit(event, payload);
  } catch (e) { console.warn(`emitToClan(${event}):`, (e as Error).message); }
}

/** Emite a la sala `dashboard:{id}` de cada admin / super_admin. */
export async function notifyAdmins(event: string, payload: unknown): Promise<void> {
  try {
    if (!_io) return;
    const User   = (await import('./models/User')).default;
    const admins = await User.find({ role: { $in: ['admin', 'super_admin'] } }).select('_id');
    for (const a of admins) _io.to(`dashboard:${String(a._id)}`).emit(event, payload);
  } catch (e) { console.warn(`notifyAdmins(${event}):`, (e as Error).message); }
}

/** Emite al dueño (User) de un personaje, si existe. */
export async function emitToCharacterOwner(characterId: unknown, event: string, payload: unknown): Promise<void> {
  try {
    if (!_io || !characterId) return;
    const User  = (await import('./models/User')).default;
    const owner = await User.findOne({ character: characterId }).select('_id');
    if (owner) _io.to(`user:${String(owner._id)}`).emit(event, payload);
  } catch (e) { console.warn(`emitToCharacterOwner(${event}):`, (e as Error).message); }
}

/** Emite a los dueños de varios personajes con una sola consulta (evita N+1). */
export async function emitToCharacterOwners(
  event: string,
  entries: Array<{ characterId: unknown; payload: unknown }>,
): Promise<void> {
  try {
    if (!_io || !entries.length) return;
    const User   = (await import('./models/User')).default;
    const owners = await User.find({ character: { $in: entries.map(e => e.characterId) } }).select('_id character').lean();
    const ownerByChar = new Map<string, string>();
    for (const o of owners) for (const c of o.character ?? []) ownerByChar.set(String(c), String(o._id));
    for (const e of entries) {
      const userId = ownerByChar.get(String(e.characterId));
      if (userId) _io.to(`user:${userId}`).emit(event, e.payload);
    }
  } catch (e) { console.warn(`emitToCharacterOwners(${event}):`, (e as Error).message); }
}
