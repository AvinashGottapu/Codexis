import { z } from 'zod';
import dotenv from 'dotenv';
import crypto from 'crypto';
import * as submissionModel from '../models/submission.model.js';
import { redisClient } from '../config/redis.js';
import { producer } from '../config/kafka.js';

dotenv.config();

// Zod Validation Schema for submissions
const submissionCreateSchema = z.object({
  problemId: z.string().uuid('Invalid problem ID format'),
  code: z.string().min(1, 'Code is required').max(128 * 1024, 'Code size exceeds limit of 128KB'),
  // Enhanced the Zod validation schema to reject any code string exceeding 128 * 1024 characters as a second layer of defense.  =>  body size restriction to secure the microservice against unbounded payloads.
  language: z.enum(['python', 'javascript', 'cpp', 'java']),
  isRunOnly: z.boolean().optional().default(false),
});

/**
 * Handle new code submissions (Runs vs. Submits)
 */
export const createSubmission = async (request, reply) => {
  try {
    // 1. Validate request body
    const validatedData = submissionCreateSchema.parse(request.body);
    const userId = request.user.userId;

    // 2. Verify problem exists in the database
    const problem = await submissionModel.verifyProblemExists(validatedData.problemId);
    if (!problem) {
      return reply.status(404).send({ error: 'Problem not found' });
    }

    // 3. Handle run-only evaluations (in-memory, skip database insertion)
    if (validatedData.isRunOnly) {
      const submissionId = `run-${userId}-${crypto.randomUUID()}`;

      await producer.send({
        topic: 'submission-tasks',
        messages: [
          {
            key: submissionId,
            value: JSON.stringify({
              submissionId,
              problemId: validatedData.problemId,
              code: validatedData.code,
              language: validatedData.language,
              isRunOnly: true,
            }),
          },
        ],
      });

      console.log(`[Submission Controller] Published temporary Run ${submissionId} to Kafka topic submission-tasks`);
      return reply.status(201).send({
        id: submissionId,
        problemId: validatedData.problemId,
        code: validatedData.code,
        language: validatedData.language,
        status: 'PENDING',
        isRunOnly: true,
      });
    }

    // 4. Check Execution Cache for final submissions (skip Docker run on Cache Hit)
    const codeHash = crypto.createHash('sha256').update(validatedData.code).digest('hex');
    const cacheKey = `cache:exec:${validatedData.problemId}:${codeHash}`;
    
    try {
      const cachedData = await redisClient.get(cacheKey);
      if (cachedData) {
        const cachedResult = JSON.parse(cachedData);
        console.log(`[Cache Hit] Serving cached execution for problem ${validatedData.problemId}, hash: ${codeHash}`);

        // Persist the completed submission directly to the database
        const submission = await submissionModel.createSubmission({
          problemId: validatedData.problemId,
          code: validatedData.code,
          language: validatedData.language,
          userId,
          status: cachedResult.status,
          executionTime: cachedResult.executionTime,
          executionMemory: cachedResult.executionMemory,
          errorDetails: cachedResult.errorDetails,
        });

        // Trigger real-time points award pipeline and WebSocket notifications via Pub/Sub
        await redisClient.publish(
          'submission:update',
          JSON.stringify({
            submissionId: submission.id,
            status: cachedResult.status,
            executionTime: cachedResult.executionTime,
            executionMemory: cachedResult.executionMemory,
            errorDetails: cachedResult.errorDetails,
          })
        );

        return reply.status(201).send(submission);
      }
    } catch (err) {
      console.error('[Cache Error] Failed to read submission cache:', err);
    }

    // 5. Handle final submissions (persisted in database on port 5433 and queued to Docker)
    const submission = await submissionModel.createSubmission({
      problemId: validatedData.problemId,
      code: validatedData.code,
      language: validatedData.language,
      userId,
    });

    await producer.send({
      topic: 'submission-tasks',
      messages: [
        {
          key: submission.id,
          value: JSON.stringify({
            submissionId: submission.id,
            problemId: submission.problemId,
            code: submission.code,
            language: submission.language,
            isRunOnly: false,
          }),
        },
      ],
    });

    console.log(`[Submission Controller] Published final Submission ${submission.id} to Kafka topic submission-tasks`);
    return reply.status(201).send(submission);

  } catch (error) {
    if (error instanceof z.ZodError) {
      return reply.status(400).send({ error: 'Validation error', details: error.errors });
    }
    console.error('Controller Error - create:', error);
    return reply.status(500).send({ error: 'Failed to process submission' });
  }
};


/**
 * Fetch a user's submission history
 */
export const getUserSubmissionHistory = async (request, reply) => {
  const userId = request.user.userId;
  try {
    const submissions = await submissionModel.getSubmissionsByUserId(userId);
    return submissions;
  } catch (error) {
    console.error('Controller Error - getUserHistory:', error);
    return reply.status(500).send({ error: 'Failed to fetch user submissions' });
  }
};

/**
 * Fetch statistics for a specific problem ID
 */
export const getProblemStats = async (request, reply) => {
  const { id: problemId } = request.params;
  try {
    // 1. Verify problem exists
    const problemExists = await submissionModel.verifyProblemExists(problemId);
    if (!problemExists) {
      return reply.status(404).send({ error: 'Problem not found' });
    }

    // 2. Query aggregated stats
    const stats = await submissionModel.getSubmissionStatsByProblemId(problemId);
    return stats;
  } catch (error) {
    console.error('Controller Error - getProblemStats:', error);
    return reply.status(500).send({ error: 'Failed to fetch problem stats' });
  }
};
