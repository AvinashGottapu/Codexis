import { redisClient } from '../config/redis.js';
import { prisma } from '../config/db.js';
import { producer } from '../config/kafka.js';

/**
 * Scan active workers and check if their heartbeats are still alive
 */
export const checkWorkerHealth = async () => {
  try {
    // Find all active worker registry keys
    const workerKeys = await redisClient.keys('codexis:workers:active:*');

    for (const key of workerKeys) {
      const workerId = key.replace('codexis:workers:active:', '');
      
      // Check if the heartbeat key exists
      const heartbeatExists = await redisClient.exists(`codexis:workers:heartbeat:${workerId}`);

      if (!heartbeatExists) {
        console.warn(`[Worker Monitor] Worker ${workerId} has crashed or lost heartbeat!`);

        // Fetch worker details before removing
        const workerInfo = await redisClient.hgetall(key);
        const { hostname, pid, activeJobId } = workerInfo;
        console.warn(`[Worker Monitor] Removing dead worker. Hostname: ${hostname}, PID: ${pid}`);

        // If the worker was busy running a job when it crashed:
        if (activeJobId) {
          console.warn(`[Worker Monitor] Worker was running active job ${activeJobId}. Initiating recovery...`);

          // Increment the retry count for this submission in Redis (expires in 1 hour)
          const retryKey = `codexis:submissions:retries:${activeJobId}`;
          const currentRetries = await redisClient.incr(retryKey);
          await redisClient.expire(retryKey, 3600);

          if (currentRetries <= 3) {
            console.log(`[Worker Monitor] Re-queuing job ${activeJobId} (Attempt ${currentRetries}/3)`);

            // Fetch submission detail from database
            const submission = await prisma.submission.findUnique({
              where: { id: activeJobId },
            });

            if (submission) {
              // 1. Update status in database back to PENDING
              await prisma.submission.update({
                where: { id: activeJobId },
                data: { status: 'PENDING' },
              });

              // 2. Publish the task back to Kafka submission-tasks
              await producer.send({
                topic: 'submission-tasks',
                messages: [{
                  key: activeJobId,
                  value: JSON.stringify({
                    submissionId: submission.id,
                    problemId: submission.problemId,
                    code: submission.code,
                    language: submission.language,
                  })
                }]
              });
              console.log(`[Worker Monitor] Successfully re-queued job ${activeJobId} back to Kafka.`);
            } else {
              console.warn(`[Worker Monitor] Submission ${activeJobId} not found in database. Skipping re-queue.`);
            }
          } else {
            console.error(`[Worker Monitor] Submission ${activeJobId} crashed workers repeatedly (${currentRetries} times). Marking as failed.`);

            // 1. Update database to RUNTIME_ERROR due to toxic loop
            await prisma.submission.update({
              where: { id: activeJobId },
              data: {
                status: 'RUNTIME_ERROR',
                errorDetails: 'Worker crashed repeatedly while processing this code (System Error).',
              },
            });

            // 2. Publish failure event to Kafka results topic so frontend updates
            await producer.send({
              topic: 'submission-results',
              messages: [{
                key: activeJobId,
                value: JSON.stringify({
                  submissionId: activeJobId,
                  status: 'RUNTIME_ERROR',
                  errorDetails: 'Worker crashed repeatedly while processing this code (System Error).',
                })
              }]
            });
            
            // Clean up the retry counter key
            await redisClient.del(retryKey);
          }
        }

        // Delete the registry key to remove the worker from the active pool
        await redisClient.del(key);
      }
    }
  } catch (err) {
    console.error('[Worker Monitor] Error during health check:', err.message || err);
  }
};

/**
 * Starts the worker monitor loop running every 10 seconds
 */
export const initWorkerMonitor = () => {
  console.log('[Worker Monitor] Initializing failure detection daemon (interval: 10s)...');
  setInterval(checkWorkerHealth, 10000);
};
