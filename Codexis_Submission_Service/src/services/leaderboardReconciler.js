import { prisma } from '../config/db.js';
import { redisClient } from '../config/redis.js';

const BATCH_SIZE = 200;
const CURSOR_KEY = 'audit:leaderboard:cursor';
const TIME_BUFFER_MS = 2 * 60 * 1000; // 2 minutes buffer for active users

/**
 * Perform a single batch audit and reconciliation tick
 */
export const reconcileLeaderboard = async () => {
  try {
    // 1. Fetch the last checked User ID (cursor) from Redis
    const lastCheckedId = await redisClient.get(CURSOR_KEY);

    // 2. Query DB for the next 100 users, excluding active ones in the last 2 minutes
    const users = await prisma.user.findMany({
      where: {
        id: lastCheckedId ? { gt: lastCheckedId } : undefined,
        submissions: {
          none: {
            createdAt: {
              gte: new Date(Date.now() - TIME_BUFFER_MS)
            }
            // Find users for whom NONE of their submissions were created within the last TIME_BUFFER_MS.
          }
        }
      },
      orderBy: { id: 'asc' },
      take: BATCH_SIZE,
      select: { id: true, points: true }
    });

    if (users.length === 0) {
      // Reached the end of the table, reset cursor to start from the beginning next time
      await redisClient.del(CURSOR_KEY);
      console.log('[Leaderboard Reconciler] Reached the end of the user database. Resetting cursor to start over.');
      return;
    }

    // 3. Batch query Redis ZSET for current leaderboard scores using a pipeline
    const getPipeline = redisClient.pipeline();
    users.forEach((user) => {
      getPipeline.zscore('leaderboard:global', user.id);
    });
    const redisResults = await getPipeline.exec();

    // 4. Compare scores and queue updates for mismatches
    const updatePipeline = redisClient.pipeline();
    let mismatchCount = 0;

    users.forEach((user, index) => {
      const redisScoreRaw = redisResults[index][1];
      const redisScore = redisScoreRaw !== null ? parseInt(redisScoreRaw, 10) : 0;

      if (user.points !== redisScore) {
        console.warn(`[Leaderboard Reconciler] Mismatch detected for user ${user.id}: DB=${user.points}, Redis=${redisScore}. Syncing...`);
        updatePipeline.zadd('leaderboard:global', user.points, user.id);
        mismatchCount++;
      }
    });

    // 5. Execute pipeline to repair mismatches
    if (mismatchCount > 0) {
      await updatePipeline.exec();
      console.log(`[Leaderboard Reconciler] Successfully healed ${mismatchCount} database-cache drifts.`);
    }

    // 6. Update the cursor in Redis to point to the last user processed in this batch
    const lastUser = users[users.length - 1];
    await redisClient.set(CURSOR_KEY, lastUser.id);
    console.log(`[Leaderboard Reconciler] Audited ${users.length} users. Next cursor ID: ${lastUser.id}`);

  } catch (err) {
    console.error('[Leaderboard Reconciler] Error during audit loop:', err);
    throw err; // bubble up for log tracking
  }
};

/**
 * Initialize the periodic reconciler on startup
 */
export const initLeaderboardReconciler = () => {
  console.log('[Leaderboard Reconciler] Background reconciliation service active.');

  const runTick = async () => {
    try {
      // A reconciler is a background process that compares two systems and makes them consistent.
      await reconcileLeaderboard();
    } catch (err) {
      console.error('[Leaderboard Reconciler] Tick execution failed:', err.message);
    } finally {
      // Schedule the next check exactly 60 seconds after the current check finishes (prevents overlaps)
      setTimeout(runTick, 30 * 1000);
    }
  };

  // Start the first loop 60 seconds after server startup to avoid system startup spikes
  setTimeout(runTick, 60 * 1000); 
};
