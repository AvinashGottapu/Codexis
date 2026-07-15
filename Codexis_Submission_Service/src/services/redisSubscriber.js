import Redis from 'ioredis';
import { prisma } from '../config/db.js';
import dotenv from 'dotenv';

dotenv.config();

const REDIS_HOST = process.env.REDIS_HOST || 'localhost';
const REDIS_PORT = parseInt(process.env.REDIS_PORT || '6379', 10);

// Create a standard Redis client for writing ZSET updates (subscriber instance cannot be used for writing)
const redisClient = new Redis({
  host: REDIS_HOST,
  port: REDIS_PORT,
});

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

        // Update submission status in the database on port 5433
        const updatedSubmission = await prisma.submission.update({
          where: { id: submissionId },
          data: {
            status,
            executionTime: executionTime !== undefined ? executionTime : undefined,
            executionMemory: executionMemory !== undefined ? executionMemory : undefined,
            errorDetails: errorDetails !== undefined ? errorDetails : undefined,
          },
        });

        console.log(`[Submission Service Redis] Successfully updated database record for submission ${submissionId}`);

        // If code execution is ACCEPTED, award points if it's the user's first time solving this problem
        if (status === 'ACCEPTED') {
          const userId = updatedSubmission.userId;
          const problemId = updatedSubmission.problemId;

          // Check if this user has already solved this problem before
          const existingAcceptedSubmissions = await prisma.submission.count({
            where: {    // TC => LOG(N) 
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
        }

      } catch (err) {
        console.error('[Submission Service Redis] Error processing message or updating database:', err.message);
      }
    }
  });
};
