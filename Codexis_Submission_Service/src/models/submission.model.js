import { prisma } from '../config/db.js';
import dotenv from 'dotenv';
import { redisClient } from '../config/redis.js';

dotenv.config();

const PROBLEM_ADMIN_SERVICE_URL = process.env.PROBLEM_ADMIN_SERVICE_URL || 'http://localhost:3001';

/**
 * Fetch problem details from the Problem Admin Service via REST API
 */
export const fetchProblemDetails = async (problemId) => {
  try {
    const res = await fetch(`${PROBLEM_ADMIN_SERVICE_URL}/api/problems/get/${problemId}`);
    if (!res.ok) return null;
    return await res.json();
  } catch (err) {
    console.error(`[Submission Model] Failed to fetch problem details for ${problemId}:`, err);
    return null;
  }
};

/**
 * Save a new submission to the database with a PENDING status
 */
export const createSubmission = async (data) => {
  return await prisma.submission.create({
    data: {
      userId: data.userId,
      problemId: data.problemId,
      code: data.code,
      language: data.language,
      status: 'PENDING',
    },
  });
};


/**
 * Fetch all submissions submitted by a specific user
 */
export const getSubmissionsByUserId = async (userId) => {
  const submissions = await prisma.submission.findMany({
    where: { userId },
    orderBy: { createdAt: 'desc' },
  });

  if (submissions.length === 0) return [];

  // Optimized: Fetch all problem cache entries in a single Redis pipeline to avoid N+1 network requests
  const pipeline = redisClient.pipeline();
  submissions.forEach((sub) => {
    pipeline.get(`cache:problem:${sub.problemId}`);
  });
  const cacheResults = await pipeline.exec();

  // Perform logical joins for all submissions
  const enrichedSubmissions = await Promise.all(
    submissions.map(async (sub, index) => {
      const cachedData = cacheResults[index][1]; // Retrieve matched result from pipeline
      let problem = null;

      if (cachedData) {
        // Cache Hit: parse directly from RAM (No HTTP call, no DB call)
        problem = JSON.parse(cachedData);
      } else {
        // Cache Miss: Fallback to HTTP REST call
        console.log(`[Cache Miss] Direct Redis miss for problem ${sub.problemId}. Falling back to HTTP REST call...`);
        problem = await fetchProblemDetails(sub.problemId);
      }

      return {
        ...sub,
        problem: problem ? { title: problem.title, difficulty: problem.difficulty } : null,
      };
    })
  );

  return enrichedSubmissions;
};

/**
 * Verify if a specific problem ID exists in the database
 */
export const verifyProblemExists = async (problemId) => {
  // Optimized: check the Redis cache directly first to bypass HTTP REST calls
  const cacheKey = `cache:problem:${problemId}`;
  try {
    const cached = await redisClient.exists(cacheKey);
    if (cached === 1) {
      return true; // Exists in cache!
    }
  } catch (err) {
    console.error(`[Submission Model] Redis exists check failed for ${problemId}:`, err);
  }

  // Fallback to HTTP REST call if cache check fails or is a miss
  const problem = await fetchProblemDetails(problemId);
  return problem !== null;
};
