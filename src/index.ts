import 'dotenv/config';
import http from 'http';
import app from './app';
import { DB } from './integrations/mongodb';
import { config, allowedOriginList } from './config';
import { init as initSocket, getIO, getUserClanIds } from './socket';
import { decodeToken } from './integrations/jwt';

interface SocketWithUser {
  userId?: string;
  handshake: { headers: { cookie?: string }; query: Record<string, string> };
  join: (room: string) => void;
}

async function main(): Promise<void> {
  console.log(`Environment: ${config.environment}`);

  try {
    await DB.connect();
    console.log('Connected to MongoDB');
  } catch {
    console.error('Unable to connect to database');
    process.exit(1);
  }

  const httpServer = http.createServer(app);

  const io = initSocket(httpServer, {
    origin: allowedOriginList.length ? allowedOriginList : false,
    credentials: true,
  });

  io.use(async (socket, next) => {
    const sock = socket as unknown as SocketWithUser;
    try {
      const cookieHeader = sock.handshake.headers.cookie ?? '';
      const match = cookieHeader.match(/(?:^|;\s*)u_tkn=([^;]*)/);
      const token = match ? decodeURIComponent(match[1]) : null;
      if (!token) { next(new Error('No token')); return; }
      const decoded = await decodeToken(token);
      const User = (await import('./models/User')).default;
      const user = await User.findById(decoded.data.id).select('status');
      if (!user || user.status !== 'active') { next(new Error('Auth failed')); return; }
      sock.userId = String(decoded.data.id);
      next();
    } catch {
      next(new Error('Auth failed'));
    }
  });

  io.on('connection', async socket => {
    const sock = socket as unknown as SocketWithUser;
    if (sock.userId) {
      sock.join(`user:${sock.userId}`);
      if (sock.handshake.query['source'] === 'dashboard') {
        sock.join(`dashboard:${sock.userId}`);
      }
      try {
        for (const clanId of await getUserClanIds(sock.userId)) sock.join(`clan:${clanId}`);
      } catch (e) {
        console.warn('Socket clan-room join error:', (e as Error).message);
      }
    }
  });

  httpServer.listen(config.port, () => {
    console.log(`Server listening on port ${config.port}`);
  });
}

main();

export { getIO };
