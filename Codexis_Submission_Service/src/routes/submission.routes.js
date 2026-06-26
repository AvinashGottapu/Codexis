import {
  createSubmission,
  getUserSubmissionHistory,
} from '../controllers/submission.controller.js';
import { authenticate } from '../middleware/auth.middleware.js';

/**
 * Fastify route definitions plugin
 */
export default async function submissionRoutes(fastify, options) {
  fastify.post('/', { preHandler: authenticate }, createSubmission);
  fastify.get('/history', { preHandler: authenticate }, getUserSubmissionHistory);
}
