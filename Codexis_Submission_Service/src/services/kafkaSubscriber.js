import { prisma } from '../config/db.js';
import dotenv from 'dotenv';
import { redisClient } from '../config/redis.js';
import { consumer } from '../config/kafka.js';
import crypto from 'crypto';

dotenv.config();

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
  }
  return false;
};

/**
 * Release a distributed lock safely using a Lua script.
 * Only deletes the key if the value matches the unique lockValue to prevent cross-client deletions.
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
 * Process a single result update task from Kafka
 */
const handleResult = async (data) => {
  const { submissionId, status, executionTime, executionMemory, errorDetails } = data;
  
  console.log(`[Kafka db-sync] Received result for submission ${submissionId} -> Status: ${status}`);

  if (submissionId.startsWith('run-')) {
    console.log(`[Kafka db-sync] Skipping database update for run-only execution ${submissionId}`);
    return;
  }

  // 1. Fetch submission metadata to construct user/problem lock key
  const submissionMeta = await prisma.submission.findUnique({
    where: { id: submissionId },
    select: { userId: true, problemId: true, code: true },
  });

  if (!submissionMeta) {
    console.error(`[Kafka db-sync] Submission metadata not found for ID: ${submissionId}`);
    return;
  }

  const { userId, problemId } = submissionMeta;
  const lockKey = `lock:user:${userId}:problem:${problemId}`;

  // 2. Wrap status updates & points allocation in a distributed lock if status is ACCEPTED
  if (status === 'ACCEPTED') {
    // Check 1: Optimistic fast path check without lock
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
    console.log(`[Kafka db-sync] Successfully updated non-accepted record for submission ${submissionId}`);
  }

  // 3. Write Execution Cache and add to problem index Set
  if (status !== 'PENDING' && status !== 'RUNNING') {
    try {
      const codeHash = crypto.createHash('sha256').update(submissionMeta.code).digest('hex');
      const cacheKey = `cache:exec:${problemId}:${codeHash}`;
      const indexKey = `cache:problem:submissions:${problemId}`;

      const cachePipeline = redisClient.pipeline();
      cachePipeline.set(
        cacheKey,
        JSON.stringify({
          status,
          executionTime: executionTime !== undefined ? executionTime : null,
          executionMemory: executionMemory !== undefined ? executionMemory : null,
          errorDetails: errorDetails !== undefined ? errorDetails : null,
        }),
        'EX',
        24 * 60 * 60 // 24 hours expiry
      );
      cachePipeline.sadd(indexKey, cacheKey);
      await cachePipeline.exec();
      console.log(`[Cache] Successfully cached result for key: ${cacheKey}`);
    } catch (cacheErr) {
      console.error('[Cache Error] Failed to write cache:', cacheErr.message);
    }
  }
};

/**
 * Initialize Kafka Consumer to listen for status updates from the Evaluator Service
 * and persist them to the database.
 */
export const initKafkaSubscriber = async () => {
  try {
    await consumer.subscribe({ topic: 'submission-results', fromBeginning: false });
    await consumer.run({
      eachMessage: async ({ topic, partition, message }) => {
        try {
          const data = JSON.parse(message.value.toString());
          await handleResult(data);
        } catch (err) {
          console.error('[Kafka db-sync] Error processing result message:', err.message || err);
        }
      },
    });
    console.log('[Kafka db-sync] Subscribed and listening to topic: submission-results');
  } catch (err) {
    console.error('[Kafka db-sync] Failed to initialize consumer:', err.message || err);
  }
};
