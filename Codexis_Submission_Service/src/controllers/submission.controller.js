import { z } from 'zod';
import { Queue } from 'bullmq';
import dotenv from 'dotenv';
import crypto from 'crypto';
import * as submissionModel from '../models/submission.model.js';

dotenv.config();

// Connect to Redis for enqueuing jobs
const REDIS_HOST = process.env.REDIS_HOST || 'localhost';
const REDIS_PORT = parseInt(process.env.REDIS_PORT || '6379', 10);

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

// Zod Validation Schema for submissions
const submissionCreateSchema = z.object({
  problemId: z.string().uuid('Invalid problem ID format'),
  code: z.string().min(1, 'Code is required'),
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
      const submissionId = `run-${crypto.randomUUID()}`;

      await runQueue.add(
        'evaluate',
        {
          submissionId,
          problemId: validatedData.problemId,
          code: validatedData.code,
          language: validatedData.language,
        },
        {
          attempts: 1,
          removeOnComplete: { count: 100 },
          removeOnFail: false,
        }
      );

      console.log(`[Submission Controller] Enqueued temporary Run ${submissionId} to run-queue`);
      return reply.status(201).send({
        id: submissionId,
        problemId: validatedData.problemId,
        code: validatedData.code,
        language: validatedData.language,
        status: 'PENDING',
        isRunOnly: true,
      });
    }

    // 4. Handle final submissions (persisted in database on port 5433)
    const submission = await submissionModel.createSubmission({
      problemId: validatedData.problemId,
      code: validatedData.code,
      language: validatedData.language,
      userId,
    });

    await submitQueue.add(
      'evaluate',
      {
        submissionId: submission.id,
        problemId: submission.problemId,
        code: submission.code,
        language: submission.language,
      },
      {
        attempts: 1,
        removeOnComplete: { count: 100 },
        removeOnFail: false,
      }
    );

    console.log(`[Submission Controller] Enqueued final Submission ${submission.id} to submit-queue`);
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
