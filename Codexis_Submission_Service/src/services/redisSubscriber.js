import Redis from 'ioredis';
import { prisma } from '../config/db.js';
import dotenv from 'dotenv';
import { redisClient } from '../config/redis.js';
import crypto from 'crypto';

dotenv.config();

const REDIS_HOST = process.env.REDIS_HOST || 'localhost';
const REDIS_PORT = parseInt(process.env.REDIS_PORT || '6379', 10);


/**
 * Acquire a distributed lock with retry backoff.
 * Stores the unique lockValue (UUID) inside Redis to verify ownership.
 */
const acquireLockWithRetry = async (lockKey, lockValue, ttlMs = 5000, maxWaitMs = 3000) => {
  const startTime = Date.now();
  const pollInterval = 100; // poll every 100ms

  while (Date.now() - startTime < maxWaitMs) {
    const result = await redisClient.set(lockKey, lockValue, 'NX', 'PX', ttlMs);
    
    if (result === 'OK') {
      return true;
    }
    await new Promise((resolve) => setTimeout(resolve, pollInterval)); 
    // Wait for 100ms and then retries again Till maxWaitMs..
  }
  return false;
};

/**
 * Release a distributed lock safely using a Lua script.
 * Only deletes the key if the value matches the unique lockValue to prevent cross-client deletions.
 * // Prevents the deltion B key by A with the help of LockValue..
 */
const releaseLock = async (lockKey, lockValue) => {
  const luaScript = `
    if redis.call("get", KEYS[1]) == ARGV[1] then
        return redis.call("del", KEYS[1])
    else
        return 0
    end
  `;
  try {
    await redisClient.eval(luaScript, 1, lockKey, lockValue);
  } catch (err) {
    console.error(`[Lock] Failed to execute safe release Lua script for ${lockKey}:`, err);
  }
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

  redisSubscriber.on('error', (err) => {
    console.error('[Submission Service Redis Subscriber] Connection error:', err.message || err);
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
          // Check 1: Optimistic fast path check without lock
          // Find if there are already any other ACCEPTED submissions for this user/problem
          const alreadySolved = await prisma.submission.count({
            where: {
              userId,
              problemId,
              status: 'ACCEPTED',
              id: { not: submissionId },
            },
          });

          if (alreadySolved > 0) {
            // Fast Path: Already solved. Skip lock entirely!
            await prisma.submission.update({
              where: { id: submissionId },
              data: {
                status,
                executionTime: executionTime !== undefined ? executionTime : undefined,
                executionMemory: executionMemory !== undefined ? executionMemory : undefined,
                errorDetails: errorDetails !== undefined ? errorDetails : undefined,
              },
            });
            console.log(`[Submission] User ${userId} has already solved problem ${problemId}. Skipped Redis lock.`);
          } else {
            // Slow Path: First time solving (potentially). Acquire lock to be safe.
            console.log(`[Lock] Attempting to acquire lock: ${lockKey} for submission ${submissionId}`);
            
            const lockValue = crypto.randomUUID(); // Generate unique value for this execution thread
            const acquired = await acquireLockWithRetry(lockKey, lockValue, 5000, 3000);
            if (!acquired) {
              console.error(`[Lock] Failed to acquire lock ${lockKey} for submission ${submissionId} (Timeout)`);
              throw new Error('Lock acquisition timeout. Concurrency limit exceeded.');
            }

            try {
              console.log(`[Lock] Lock ACQUIRED: ${lockKey} with value ${lockValue} for submission ${submissionId}`);

              // Update submission status in the database
              await prisma.submission.update({
                where: { id: submissionId },
                data: {
                  status,
                  executionTime: executionTime !== undefined ? executionTime : undefined,
                  executionMemory: executionMemory !== undefined ? executionMemory : undefined,
                  errorDetails: errorDetails !== undefined ? errorDetails : undefined,
                },
              });

              // Check 2: Double-check under lock (excludes the current submission)
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
                 // If server got crashed here ?? 
                // Yes! In this case, the Reconciler works 100% perfectly..
              

                // 2. Update Redis ZSET Leaderboard
                await redisClient.zincrby('leaderboard:global', 10, userId);
                console.log(`[Leaderboard] Successfully updated Redis ZSET leaderboard:global for user ${userId}`);
              } else {
                console.log(`[Leaderboard] User ${userId} has already solved problem ${problemId} before. No points awarded.`);
              }

            } finally {
              // Always release the lock key safely using Lua verification
              await releaseLock(lockKey, lockValue);
              console.log(`[Lock] Lock RELEASED safely: ${lockKey} for submission ${submissionId}`);
            }
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
