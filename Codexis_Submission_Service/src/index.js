import Fastify from 'fastify';
import dotenv from 'dotenv';
import submissionRoutes from './routes/submission.routes.js';
import leaderboardRoutes from './routes/leaderboard.routes.js';
import { initRedisSubscriber } from './services/redisSubscriber.js';
import { initLeaderboardReconciler } from './services/leaderboardReconciler.js';

dotenv.config();

const fastify = Fastify({ logger: true });

// Register modular routers
fastify.register(submissionRoutes, { prefix: '/api/submissions' });
fastify.register(leaderboardRoutes, { prefix: '/api/leaderboard' });

// Initialize Redis Subscriber to sync database statuses from evaluator
initRedisSubscriber();

// Initialize the background Leaderboard Reconciler (Eventual Consistency)
initLeaderboardReconciler();

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
