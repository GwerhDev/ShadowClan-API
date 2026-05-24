const { Server } = require('socket.io');

let _io = null;

module.exports = {
  init(httpServer, corsOptions) {
    _io = new Server(httpServer, { cors: corsOptions });
    return _io;
  },
  getIO() {
    if (!_io) throw new Error('Socket.IO not initialized');
    return _io;
  },
};
