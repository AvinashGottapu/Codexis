import { getLeaderboard } from '../controllers/leaderboard.controller.js';

/**
 * Fastify route definitions plugin for Leaderboard
 */
export default async function leaderboardRoutes(fastify, options) {
  fastify.get('/global', getLeaderboard);
}
