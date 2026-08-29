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
