import { randomUUID } from 'crypto';
import os from 'os';
import { redisClient } from '../config/redis.js';

// Generate a unique ID for this worker instance on boot
export const WORKER_ID = randomUUID();

const REGISTRY_KEY = `codexis:workers:active:${WORKER_ID}`;

/**
 * Register this worker in Redis with system details
 */
const HEARTBEAT_KEY = `codexis:workers:heartbeat:${WORKER_ID}`;

/**
 * Starts the heartbeat loop pinging Redis every 5 seconds with a 15-second TTL
 */
export const startHeartbeat = () => {
  console.log(`[Worker Heartbeat] Starting heartbeat loop (refresh: 5s, TTL: 15s)...`);
  
  setInterval(async () => {
    try {
      // Set the heartbeat key to "alive" with an expiration of 15 seconds
      await redisClient.set(HEARTBEAT_KEY, 'alive', 'EX', 15);
    } catch (err) {
      console.error('[Worker Heartbeat] Failed to send heartbeat:', err.message || err);
    }
  }, 5000);
};

/**
 * Register this worker in Redis with system details
 */
export const registerWorker = async () => {
  try {
    const metadata = {
      id: WORKER_ID,
      hostname: os.hostname(),
      pid: process.pid.toString(),
      bootTime: new Date().toISOString(),
      status: 'IDLE',
      activeJobId: '', // Empty initially
    };

    // Save metadata as a Redis Hash Map
    await redisClient.hset(REGISTRY_KEY, metadata);
    console.log(`[Worker Registry] Registered successfully with ID: ${WORKER_ID}`);
    
    // Start the heartbeat keep-alive loop
    startHeartbeat();
  } catch (err) {
    console.error('[Worker Registry] Failed to register worker:', err.message || err);
  }
};

/**
 * Update worker state to BUSY with active job ID
 */
export const setActiveJob = async (submissionId) => {
  try {
    await redisClient.hset(REGISTRY_KEY, {
      status: 'BUSY',
      activeJobId: submissionId,
    });
  } catch (err) {
    console.error(`[Worker Registry] Failed to set active job:`, err.message || err);
  }
};

/**
 * Reset worker state to IDLE and clear active job ID
 */
export const clearActiveJob = async () => {
  try {
    await redisClient.hset(REGISTRY_KEY, {
      status: 'IDLE',
      activeJobId: '',
    });
  } catch (err) {
    console.error(`[Worker Registry] Failed to clear active job:`, err.message || err);
  }
};

/**
 * Try to acquire an execution lock for a submission.
 * Returns true if the job is already processed or currently running.
 * Returns false if the lock was successfully acquired.
 */
export const acquireJobLock = async (submissionId) => {
  try {
    const lockKey = `codexis:submissions:lock:${submissionId}`;
    const processedKey = `codexis:submissions:processed:${submissionId}`;

    // 1. Check if the job was already completed
    const processedExists = await redisClient.exists(processedKey);
    if (processedExists === 1) {
      return true; // Already processed
    }

    // 2. Try to set the Active Lock key (NX: only if not exists, EX 600: 10 mins expiry)
    const acquired = await redisClient.set(lockKey, 'processing', 'NX', 'EX', 600);
    if (!acquired) {
      return true; // Lock is held by another worker
    }

    return false; // Lock acquired successfully
  } catch (err) {
    console.error(`[Worker Registry] Lock acquisition failed:`, err.message || err);
    return false; // Fallback: allow run on Redis failure
  }
};

/**
 * Release the active execution lock
 */
export const releaseJobLock = async (submissionId) => {
  try {
    await redisClient.del(`codexis:submissions:lock:${submissionId}`);
  } catch (err) {
    console.error(`[Worker Registry] Failed to release lock:`, err.message || err);
  }
};

/**
 * Mark a submission as completed (cached in Redis for 24 hours)
 */
export const markJobProcessed = async (submissionId) => {
  try {
    await redisClient.set(`codexis:submissions:processed:${submissionId}`, '1', 'EX', 86400);
  } catch (err) {
    console.error(`[Worker Registry] Failed to set processed key:`, err.message || err);
  }
};
