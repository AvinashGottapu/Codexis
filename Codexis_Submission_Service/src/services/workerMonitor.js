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

          // Add the dead worker's ID to the set of crashed workers (idempotent, prevents double-counting on retry)
          const retrySetKey = `codexis:submissions:crashed_workers:${activeJobId}`;
          await redisClient.sadd(retrySetKey, workerId);
          await redisClient.expire(retrySetKey, 3600);

          // Get the number of unique worker crashes
          const uniqueCrashes = await redisClient.scard(retrySetKey);

          if (uniqueCrashes <= 3) {
            console.log(`[Worker Monitor] Interrupted job ${activeJobId} detected (Unique Crashes: ${uniqueCrashes}/3). Setting DB status to PENDING. Relying on Kafka native redelivery.`);

            // Update status in database back to PENDING so UI stays updated
            await prisma.submission.update({
              where: { id: activeJobId },
              data: { status: 'PENDING' },
            });
          } else {
            console.error(`[Worker Monitor] Submission ${activeJobId} crashed workers repeatedly (${uniqueCrashes} times). Marking as failed and routing to DLQ.`);

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

            // 3. Route the poison pill submission payload to DLQ for admin analysis
            try {
              const submission = await prisma.submission.findUnique({
                where: { id: activeJobId }
              });

              if (submission) {
                await producer.send({
                  topic: 'submission-tasks-dlq',
                  messages: [{
                    key: activeJobId,
                    value: JSON.stringify({
                      submissionId: submission.id,
                      userId: submission.userId,
                      problemId: submission.problemId,
                      code: submission.code,
                      language: submission.language,
                      attempts: uniqueCrashes,
                      crashedAt: new Date().toISOString(),
                    })
                  }]
                });
                console.log(`[Worker Monitor] Successfully routed crashed submission ${activeJobId} to DLQ topic.`);
              }
            } catch (dlqErr) {
              console.error(`[Worker Monitor] Failed to route submission ${activeJobId} to DLQ:`, dlqErr.message || dlqErr);
            }
            
            // Clean up the retry counter key
            await redisClient.del(retrySetKey);
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