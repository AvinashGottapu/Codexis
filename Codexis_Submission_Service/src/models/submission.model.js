import { prisma } from '../config/db.js';
import dotenv from 'dotenv';

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

  // Perform logical joins for all submissions
  const enrichedSubmissions = await Promise.all(
    submissions.map(async (sub) => {
      const problem = await fetchProblemDetails(sub.problemId);
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
  const problem = await fetchProblemDetails(problemId);
  return problem !== null;
};
