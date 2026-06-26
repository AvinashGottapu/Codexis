import { Queue } from 'bullmq';
import { createBullBoard } from '@bull-board/api';
import { BullMQAdapter } from '@bull-board/api/bullMQAdapter.js';
import { ExpressAdapter } from '@bull-board/express';
import dotenv from 'dotenv';

dotenv.config();

const REDIS_HOST = process.env.REDIS_HOST || 'localhost';
const REDIS_PORT = parseInt(process.env.REDIS_PORT || '6379', 10);

// Setup Queue connection for Bull Board mapping
const runQueue = new Queue('run-queue', {
  connection: {
    host: REDIS_HOST,
    port: REDIS_PORT,
  },
});

const submitQueue = new Queue('submit-queue', {
  connection: {
    host: REDIS_HOST,
    port: REDIS_PORT,
  },
});

/**
 * Initializes and returns the Bull Board Express router adapter
 */

export const getDashboardRouter = () => {
  const serverAdapter = new ExpressAdapter();
  serverAdapter.setBasePath('/bull');
  
  createBullBoard({
    queues: [
      new BullMQAdapter(runQueue),
      new BullMQAdapter(submitQueue),
    ],
    serverAdapter: serverAdapter,
  });

  return serverAdapter.getRouter();
};
