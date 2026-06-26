import Redis from 'ioredis';
import { prisma } from '../config/db.js';
import dotenv from 'dotenv';

dotenv.config();

const REDIS_HOST = process.env.REDIS_HOST || 'localhost';
const REDIS_PORT = parseInt(process.env.REDIS_PORT || '6379', 10);

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
        await prisma.submission.update({
          where: { id: submissionId },
          data: {
            status,
            executionTime: executionTime !== undefined ? executionTime : undefined,
            executionMemory: executionMemory !== undefined ? executionMemory : undefined,
            errorDetails: errorDetails !== undefined ? errorDetails : undefined,
          },
        });

        console.log(`[Submission Service Redis] Successfully updated database record for submission ${submissionId}`);

      } catch (err) {
        console.error('[Submission Service Redis] Error processing message or updating database:', err.message);
      }
    }
  });
};
