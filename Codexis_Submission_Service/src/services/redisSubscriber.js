import Redis from 'ioredis';
import { prisma } from '../config/db.js';
import dotenv from 'dotenv';

dotenv.config();

const REDIS_HOST = process.env.REDIS_HOST || 'localhost';
const REDIS_PORT = parseInt(process.env.REDIS_PORT || '6379', 10);

// Create a standard Redis client for writing updates and locks (subscriber instance cannot be used)
const redisClient = new Redis({
  host: REDIS_HOST,
  port: REDIS_PORT,
});


const acquireLockWithRetry = async (lockKey, ttlMs = 5000, maxWaitMs = 3000) => {
  const startTime = Date.now();
  const pollInterval = 100; // poll every 100ms

  while (Date.now() - startTime < maxWaitMs) {
    const result = await redisClient.set(lockKey, 'locked', 'NX', 'PX', ttlMs);
    
    if (result === 'OK') {
      return true;
    }
    await new Promise((resolve) => setTimeout(resolve, pollInterval)); 
    // Wait for 100ms and then retries again Till maxWaitMs..
  }
  return false;
};

/**
 * Initialize Redis Subscriber to listen for status updates from the Evaluator Service
 * and persist them to the User/Submission Database (port 5433).
 */
export const initRedisSubscriber = () => {
  const redisSubscriber = new Redis({
    host: REDIS_HOST,
    port: REDIS_PORT,
  });

  redisSubscriber.subscribe('submission:update', (err, count) => {
    if (err) {
      console.error('[Submission Service Redis] Failed to subscribe to submission:update:', err);
    } else {
      console.log(`[Submission Service Redis] Subscribed to submission:update channel (${count} channel(s))`);
    }
  });

  redisSubscriber.on('message', async (channel, message) => {
    if (channel === 'submission:update') {
      try {
        const data = JSON.parse(message);
        const { submissionId, status, executionTime, executionMemory, errorDetails } = data;
        
        console.log(`[Submission Service Redis] Received update for submission ${submissionId} -> Status: ${status}`);

        if (submissionId.startsWith('run-')) {
          console.log(`[Submission Service Redis] Skipping database update for run-only execution ${submissionId}`);
          return;
        }

        // 1. Fetch submission metadata to construct user/problem lock key
        const submissionMeta = await prisma.submission.findUnique({
          where: { id: submissionId },
          select: { userId: true, problemId: true },
        });

        if (!submissionMeta) {
          console.error(`[Submission Service Redis] Submission metadata not found for ID: ${submissionId}`);
          return;
        }

        const { userId, problemId } = submissionMeta;
        const lockKey = `lock:user:${userId}:problem:${problemId}`;

        // 2. Wrap status updates & points allocation in a distributed lock if status is ACCEPTED
        if (status === 'ACCEPTED') {
          console.log(`[Lock] Attempting to acquire lock: ${lockKey} for submission ${submissionId}`);
          
          const acquired = await acquireLockWithRetry(lockKey, 5000, 3000);
          if (!acquired) {
            console.error(`[Lock] Failed to acquire lock ${lockKey} for submission ${submissionId} (Timeout)`);
            throw new Error('Lock acquisition timeout. Concurrency limit exceeded.');
          }

          try {
            console.log(`[Lock] Lock ACQUIRED: ${lockKey} for submission ${submissionId}`);

            // Update submission status in the database
            const updatedSubmission = await prisma.submission.update({
              where: { id: submissionId },
              data: {
                status,
                executionTime: executionTime !== undefined ? executionTime : undefined,
                executionMemory: executionMemory !== undefined ? executionMemory : undefined,
                errorDetails: errorDetails !== undefined ? errorDetails : undefined,
              },
            });

            // Check if this user has already solved this problem before (excluding the current one)
            const existingAcceptedSubmissions = await prisma.submission.count({
              where: {
                userId,
                problemId,
                status: 'ACCEPTED',
                id: { not: submissionId },
              },
            });

            if (existingAcceptedSubmissions === 0) {
              console.log(`[Leaderboard] First-time accept for user ${userId} on problem ${problemId}! Awarding 10 points.`);

              // 1. Update SQL Database points
              await prisma.user.update({
                where: { id: userId },
                data: {
                  points: { increment: 10 },
                },
              });

              // 2. Update Redis ZSET Leaderboard
              await redisClient.zincrby('leaderboard:global', 10, userId);
              console.log(`[Leaderboard] Successfully updated Redis ZSET leaderboard:global for user ${userId}`);
            } else {
              console.log(`[Leaderboard] User ${userId} has already solved problem ${problemId} before. No points awarded.`);
            }

          } finally {
            // Always release the lock key
            await redisClient.del(lockKey);
            console.log(`[Lock] Lock RELEASED: ${lockKey} for submission ${submissionId}`);
          }

        } else {
          // Non-ACCEPTED updates do not require a lock (no points are modified)
          await prisma.submission.update({
            where: { id: submissionId },
            data: {
              status,
              executionTime: executionTime !== undefined ? executionTime : undefined,
              executionMemory: executionMemory !== undefined ? executionMemory : undefined,
              errorDetails: errorDetails !== undefined ? errorDetails : undefined,
            },
          });
          console.log(`[Submission Service Redis] Successfully updated non-accepted record for submission ${submissionId}`);
        }

      } catch (err) {
        console.error('[Submission Service Redis] Error processing message or updating database:', err.message);
      }
    }
  });
};
