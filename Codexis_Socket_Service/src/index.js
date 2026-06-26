import express from 'express';
import { createServer } from 'http';
import { Server } from 'socket.io';
import dotenv from 'dotenv';
import { registerSocketHandlers } from './sockets/handlers.js';
import { initRedisSubscriber } from './services/redisSubscriber.js';

dotenv.config();

const app = express();

// CORS Middleware
app.use((req, res, next) => {
  res.header('Access-Control-Allow-Origin', '*');
  res.header('Access-Control-Allow-Headers', 'Origin, X-Requested-With, Content-Type, Accept');
  res.header('Access-Control-Allow-Methods', 'GET, POST, PUT, DELETE, OPTIONS');
  if (req.method === 'OPTIONS') {
    return res.sendStatus(200);
  }
  next();
});

const httpServer = createServer(app);
const PORT = process.env.PORT || 3004;
const ORIGIN = process.env.ORIGIN || '*';


// Initialize Socket.IO
const io = new Server(httpServer, {
  cors: {
    origin: ORIGIN,
    methods: ['GET', 'POST'],
  },
});

// Socket connection listener
io.on('connection', (socket) => {
  registerSocketHandlers(io, socket);
});

// Start Redis Pub/Sub subscription and relaying
initRedisSubscriber(io);

// Health check endpoint
app.get('/health', (req, res) => {
  res.json({ status: 'ok', service: 'codexis-socket-service' });
});

// Start Server
httpServer.listen(PORT, () => {
  console.log(`[Socket Service] WebSocket server running on port ${PORT}`);
});
