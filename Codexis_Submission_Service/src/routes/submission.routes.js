import {
  createSubmission,
  getUserSubmissionHistory,
  getProblemStats,
} from '../controllers/submission.controller.js';
import { authenticate } from '../middleware/auth.middleware.js';
import { rateLimiter } from '../middleware/rateLimiter.middleware.js';

/**
 * Fastify route definitions plugin
 */
export default async function submissionRoutes(fastify, options) {
  fastify.post('/', { 
    preHandler: [authenticate, rateLimiter],
    bodyLimit: 128 * 1024 // Limit request body size to 128KB to prevent payload bloat
  }, createSubmission);
  fastify.get('/history', { preHandler: authenticate }, getUserSubmissionHistory);
  fastify.get('/problem/:id/stats', { preHandler: authenticate }, getProblemStats);
}
