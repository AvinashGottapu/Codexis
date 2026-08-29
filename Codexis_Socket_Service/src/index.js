import express from 'express';
import { createServer } from 'http';
import { Server } from 'socket.io';
import dotenv from 'dotenv';
import { verifyToken } from '@clerk/backend';
import { registerSocketHandlers } from './sockets/handlers.js';
import { connectKafka } from './config/kafka.js';
import { initKafkaSubscriber } from './services/kafkaSubscriber.js';

dotenv.config();

const app = express();

const httpServer = createServer(app);
const PORT = process.env.PORT || 3004;
const ORIGIN = process.env.ORIGIN || '*';
const CLERK_SECRET_KEY = process.env.CLERK_SECRET_KEY;

// Initialize Socket.IO
const io = new Server(httpServer, {
  cors: {
    origin: ORIGIN,
    methods: ['GET', 'POST'],
  },
});

// Middleware to authenticate socket connections using Clerk JWT Session Tokens
io.use(async (socket, next) => {
  try {
    const authHeader = socket.handshake.auth?.token || socket.handshake.headers?.authorization;
    if (!authHeader || !authHeader.startsWith('Bearer ')) {
      console.warn(`[Socket] Connection rejected: No Bearer token provided for socket ${socket.id}`);
      return next(new Error('Authentication token required'));
    }

    const token = authHeader.split(' ')[1];
    
    // Verify token using Clerk public keys (JWKS)
    const decoded = await verifyToken(token, {
      secretKey: CLERK_SECRET_KEY,
      clockSkewInMs: 30000, // 30 seconds buffer for clock skew
    });

    // Attach verified user ID to socket instance
    socket.user = {
      userId: decoded.sub
    };

    console.log(`[Socket] Authenticated socket connection for user: ${decoded.sub}`);
    next();
  } catch (err) {
    console.error(`[Socket] Handshake Auth Failed for socket ${socket.id}:`, err.message);
    next(new Error('Invalid or expired authentication token'));
  }
});

// Socket connection listener
io.on('connection', (socket) => {
  registerSocketHandlers(io, socket);
});

// Health check endpoint
app.get('/health', (req, res) => {
  res.json({ status: 'ok', service: 'codexis-socket-service' });
});

// Start Server and Kafka Subscriber
const start = async () => {
  try {
    await connectKafka();
    await initKafkaSubscriber(io);
    
    httpServer.listen(PORT, () => {
      console.log(`[Socket Service] WebSocket server running on port ${PORT}`);
    });
  } catch (err) {
    console.error('[Socket Service] Failed to start WebSocket service:', err);
    process.exit(1);
  }
};

start();
