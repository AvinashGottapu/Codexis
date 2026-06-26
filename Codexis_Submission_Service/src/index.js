import Fastify from 'fastify';
import cors from '@fastify/cors';
import dotenv from 'dotenv';
import submissionRoutes from './routes/submission.routes.js';
import { initRedisSubscriber } from './services/redisSubscriber.js';

dotenv.config();

const fastify = Fastify({ logger: true });

// Register CORS
fastify.register(cors, {
  origin: '*',
  methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
});

// Register modular routers
fastify.register(submissionRoutes, { prefix: '/api/submissions' });

// Initialize Redis Subscriber to sync database statuses from evaluator
initRedisSubscriber();

// Health check endpoint
fastify.get('/health', async () => {
  return { status: 'ok', service: 'codexis-submission-service' };
});

// Start listening
const start = async () => {
  const PORT = parseInt(process.env.PORT || '3003', 10);
  try {
    await fastify.listen({ port: PORT, host: '0.0.0.0' });
    console.log(`[Submission Service] Running on port ${PORT}`);
  } catch (err) {
    fastify.log.error(err);
    process.exit(1);
  }
};

start();
