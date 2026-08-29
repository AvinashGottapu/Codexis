import express from 'express';
import dotenv from 'dotenv';

// Import our database client, Docker sandbox manager, and Kafka config
import { prisma } from './config/db.js';
import { evaluateSubmission } from './sandbox/sandbox.manager.js';
import { sweepOrphansOnBoot } from './sandbox/docker.js';
import { producer, consumer, connectKafka } from './config/kafka.js';
import { registerWorker, setActiveJob, clearActiveJob } from './services/workerRegistry.js';

dotenv.config();

const app = express();
const PORT = process.env.PORT || 3002;

app.use(express.json());

// Shared processor function to evaluate submissions
const processJob = async (task) => {
  const { submissionId, problemId, code, language, isRunOnly } = task;
  const queueLabel = isRunOnly ? 'Run' : 'Submit';
  console.log(`[Worker - ${queueLabel}] Processing submission ${submissionId} for problem ${problemId} (${language})`);

  // Register that this worker is busy with this active job
  await setActiveJob(submissionId);

  try {
    // 1. Publish "RUNNING" state to Kafka topic submission-results
    await producer.send({
      topic: 'submission-results',
      messages: [{
        key: submissionId,
        value: JSON.stringify({
          submissionId,
          status: 'RUNNING',
        })
      }]
    });

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
      problem.timeLimit,
      problem.memoryLimit
    );

    console.log(`[Worker - ${queueLabel}] Evaluation completed for ${submissionId}. Result: ${result.status}`);

    // 5. Publish the final outcome to Kafka topic submission-results
    await producer.send({
      topic: 'submission-results',
      messages: [{
        key: submissionId,
        value: JSON.stringify({
          submissionId,
          status: result.status,
          executionTime: result.executionTime,
          executionMemory: result.executionMemory,
          errorDetails: result.errorDetails,
        })
      }]
    });

  } catch (err) {
    console.error(`[Worker - ${queueLabel}] Error running job ${submissionId}:`, err);

    // Notify users & Submission Service via Kafka about the crash
    await producer.send({
      topic: 'submission-results',
      messages: [{
        key: submissionId,
        value: JSON.stringify({
          submissionId,
          status: 'RUNTIME_ERROR',
          errorDetails: err.message,
        })
      }]
    });
  } finally {
    // Reset worker state to IDLE and clear activeJobId
    await clearActiveJob();
  }
};

// Health check endpoint
app.get('/health', (req, res) => {
  res.json({ status: 'ok', service: 'codexis-evaluator-service' });
});

// Run system recovery sweeper on boot to clean any orphan containers from previous crashes
await sweepOrphansOnBoot();

// Connect to Kafka and start consuming messages
const runConsumer = async () => {
  // Register this worker instance in Redis on startup
  await registerWorker();

  await connectKafka();
  
  await consumer.subscribe({ topic: 'submission-tasks', fromBeginning: false });
  
  await consumer.run({
    eachMessage: async ({ topic, partition, message }) => {
      try {
        const task = JSON.parse(message.value.toString());
        await processJob(task);
      } catch (err) {
        console.error('[Kafka Consumer] Error processing message:', err.message || err);
      }
    }
  });

  console.log('[Evaluator Service] Kafka consumer listening to topic: submission-tasks');
};

runConsumer().catch(err => {
  console.error('[Evaluator Service] Failed to start Kafka consumer:', err);
});

// Start Express server for API endpoints (like healthcheck)
app.listen(PORT, () => {
  console.log(`[Evaluator Service] Running on port ${PORT}`);
});
