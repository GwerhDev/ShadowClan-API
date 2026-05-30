import { Server } from 'socket.io';
import type { Server as HttpServer } from 'http';

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
