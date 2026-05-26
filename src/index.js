require("dotenv").config();
const http = require('http');
const app = require('./app');
const db = require("./integrations/mongodb");
const { port, allowedOrigins } = require('./config');
const { init: initSocket } = require('./socket');
const { decodeToken } = require('./integrations/jwt');

async function main() {
  console.log(process.env.NODE_ENV);
  try {
    await db.connect();
    console.log("Succesfully connected");
  } catch (error) {
    console.error("Unable to connect to database");
  }

  const httpServer = http.createServer(app);

  let origins = [];
  try {
    const parsed = JSON.parse(allowedOrigins);
    origins = Array.isArray(parsed) ? parsed : [String(parsed)];
  } catch {
    origins = (allowedOrigins ?? '').split(',').map(o => o.trim()).filter(Boolean);
  }
  const io = initSocket(httpServer, {
    origin: origins.length ? origins : false,
    credentials: true,
  });

  io.use(async (socket, next) => {
    try {
      const cookieHeader = socket.handshake.headers.cookie || '';
      const match = cookieHeader.match(/(?:^|;\s*)u_tkn=([^;]*)/);
      const token = match ? decodeURIComponent(match[1]) : null;
      if (!token) return next(new Error('No token'));
      const decoded = await decodeToken(token);
      socket.userId = String(decoded.data.id);
      next();
    } catch {
      next(new Error('Auth failed'));
    }
  });

  io.on('connection', (socket) => {
    socket.join(`user:${socket.userId}`);
    if (socket.handshake.query.source === 'dashboard') {
      socket.join(`dashboard:${socket.userId}`);
    }
  });

  httpServer.listen(port, () => console.log(`Server listening on port ${port}`));
}

main();
