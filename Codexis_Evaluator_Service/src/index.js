import express from 'express';
import { Worker } from 'bullmq';
import Redis from 'ioredis';
import dotenv from 'dotenv';
import dashboardRouter from './routes/dashboard.routes.js';

// Import our database client and Docker sandbox manager
import { prisma } from './config/db.js';
import { evaluateSubmission } from './sandbox/sandbox.manager.js';

dotenv.config();

const app = express();
const PORT = process.env.PORT || 3002;

// Connect to Redis for publishing real-time events to Socket Service
const REDIS_HOST = process.env.REDIS_HOST || 'localhost';
const REDIS_PORT = parseInt(process.env.REDIS_PORT || '6379', 10);

const redisPublisher = new Redis({
  host: REDIS_HOST,
  port: REDIS_PORT,
});

app.use(express.json());

// Mount the modular Bull Board dashboard router under the /ui prefix
app.use('/bull', dashboardRouter);

// Shared processor function to evaluate submissions
const processJob = async (job, isRunOnly) => {
  const { submissionId, problemId, code, language } = job.data;
  const queueLabel = isRunOnly ? 'Run' : 'Submit';
  console.log(`[Worker - ${queueLabel}] Processing submission ${submissionId} for problem ${problemId} (${language})`);

  try {
    // 1. Publish "RUNNING" state to Redis Pub/Sub for the Socket & Submission Services
    await redisPublisher.publish(
      'submission:update',
      JSON.stringify({
        submissionId,
        status: 'RUNNING',
      })
    );

    // 2. Fetch problem parameters and test cases from database
    const problem = await prisma.problem.findUnique({
      where: { id: problemId },
      include: { testcases: true },
    });

    if (!problem) {
      throw new Error(`Problem with ID ${problemId} not found`);
    }

    // 3. Filter test cases if it is a run-only task (visible/sample test cases only)
    const testcasesToRun = isRunOnly
      ? problem.testcases.filter(tc => tc.isSample)
      : problem.testcases;

    if (testcasesToRun.length === 0) {
      throw new Error(isRunOnly ? 'No sample test cases defined for this problem.' : 'No test cases defined for this problem.');
    }

    // 4. Run the code inside the Docker Sandbox
    const result = await evaluateSubmission(
      submissionId,
      code,
      language,
      testcasesToRun,
      problem.timeLimit
    );

    console.log(`[Worker - ${queueLabel}] Evaluation completed for ${submissionId}. Result: ${result.status}`);

    // 5. Publish the final outcome to Redis Pub/Sub for the Socket & Submission Services
    await redisPublisher.publish(
      'submission:update',
      JSON.stringify({
        submissionId,
        status: result.status,
        executionTime: result.executionTime,
        executionMemory: result.executionMemory,
        errorDetails: result.errorDetails,
      })
    );

  } catch (err) {
    console.error(`[Worker - ${queueLabel}] Error running job ${job.id}:`, err);

    // Notify users & Submission Service via Pub/Sub about the crash
    await redisPublisher.publish(
      'submission:update',
      JSON.stringify({
        submissionId,
        status: 'RUNTIME_ERROR',
        errorDetails: err.message,
      })
    );
  }
};

// Create the run-queue worker
const runWorker = new Worker(
  'run-queue',
  async (job) => await processJob(job, true),
  {
    connection: {
      host: REDIS_HOST,
      port: REDIS_PORT,
    },
    concurrency: 2,
  }
);

// Create the submit-queue worker
const submitWorker = new Worker(
  'submit-queue',
  async (job) => await processJob(job, false),
  {
    connection: {
      host: REDIS_HOST,
      port: REDIS_PORT,
    },
    concurrency: 2,
  }
);

// Setup event listeners for logging
runWorker.on('completed', (job) => {
  console.log(`[Run Worker] Job ${job.id} completed`);
});
runWorker.on('failed', (job, err) => {
  console.error(`[Run Worker] Job ${job.id} failed:`, err);
});

submitWorker.on('completed', (job) => {
  console.log(`[Submit Worker] Job ${job.id} completed`);
});
submitWorker.on('failed', (job, err) => {
  console.error(`[Submit Worker] Job ${job.id} failed:`, err);
});

// Health check endpoint
app.get('/health', (req, res) => {
  res.json({ status: 'ok', service: 'codexis-evaluator-service' });
});

// Start Express server for Bull Board
app.listen(PORT, () => {
  console.log(`[Evaluator Service] Queue monitor dashboard active at http://localhost:${PORT}/bull`);
  console.log(`[Evaluator Service] Workers are listening to run-queue and submit-queue...`);
});
