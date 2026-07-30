import Redis from 'ioredis';
import { prisma } from '../config/db.js';
import dotenv from 'dotenv';

dotenv.config();

const REDIS_HOST = process.env.REDIS_HOST || 'localhost';
const REDIS_PORT = parseInt(process.env.REDIS_PORT || '6379', 10);

const redisClient = new Redis({
  host: REDIS_HOST,
  port: REDIS_PORT,
});

redisClient.on('error', (err) => {
  console.error('[Redis Leaderboard Client] Connection error:', err.message || err);
});

/**
 * Fetch the global leaderboard.
 * Operates on Cache-Aside:
 * 1. Checks Redis ZSET `leaderboard:global`.
 * 2. If empty (cold start), queries PostgreSQL to build the cache, then returns it.
 * 3. Resolves User IDs to profiles (usernames, imageUrls) in a single database hit.
 */
export const getLeaderboard = async (request, reply) => {
  try {
    // 1. Fetch top 50 from Redis Sorted Set
    let leaderboardRaw = await redisClient.zrevrange('leaderboard:global', 0, 49, 'WITHSCORES');
    // We can later apply the pagination for all users with the help of the page index...

    let rankings = [];

    // 2. Cold Start Fallback: If Redis has no data, populate it from the SQL DB
    // If Redis is empty—for example, after a restart or during the first deployment
    if (!leaderboardRaw || leaderboardRaw.length === 0) {
      console.log('[Leaderboard API] Cache miss. Rebuilding leaderboard ZSET from database...');
      
      const topUsers = await prisma.user.findMany({
        where: { points: { gt: 0 } },
        orderBy: { points: 'desc' },
        take: 50, // Cache up to top 50 in Redis
      });

      if (topUsers.length > 0) {
        // Multi block to bulk write in one round-trip
        const pipeline = redisClient.multi();
        //  By using multi(), Redis guarantees that none of the users are visible until all 50 are written. It is all-or-nothing.
        topUsers.forEach((user) => {
          pipeline.zadd('leaderboard:global', user.points, user.id);
        });
        await pipeline.exec();

        // Refetch from Redis
        leaderboardRaw = await redisClient.zrevrange('leaderboard:global', 0, 49, 'WITHSCORES');
      }
    }

    // 3. Process Redis response
    // Redis returns flat array: [userId1, score1, userId2, score2, ...]
    const userIds = [];
    const scoreMap = {};

    for (let i = 0; i < leaderboardRaw.length; i += 2) {
      const userId = leaderboardRaw[i];
      const score = parseInt(leaderboardRaw[i + 1], 10);
      userIds.push(userId);
      scoreMap[userId] = score;
    }

    if (userIds.length > 0) {
      // 4. Resolve usernames and images in a single SQL query
      const users = await prisma.user.findMany({
        where: { id: { in: userIds } }, // TC => K*LOG(N)
        select: {
          id: true,
          username: true,
          imageUrl: true,
        },
      });

      // Map users to maintain the exact rank order returned by Redis
      rankings = userIds.map((id, index) => {
        const userProfile = users.find((u) => u.id === id);
        return {
          rank: index + 1,
          userId: id,
          username: userProfile ? userProfile.username : 'Deleted User',
          imageUrl: userProfile ? userProfile.imageUrl : null,
          points: scoreMap[id],
        };
      });
    }

    return reply.code(200).send(rankings);

  } catch (err) {
    console.error('[Leaderboard API] Error fetching leaderboard:', err);
    return reply.code(500).send({ error: 'Failed to retrieve global leaderboard.' });
  }
};
