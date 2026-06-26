import { prisma } from '../config/db.js';

/**
 * Fetch all problems with basic metadata fields
 */
export const getAllProblems = async () => {
  return await prisma.problem.findMany({
    select: {
      id: true,
      title: true,
      difficulty: true,
      tags: true,
      companies: true,
      timeLimit: true,
      memoryLimit: true,
      createdAt: true,
      updatedAt: true,
    },
    orderBy: { createdAt: 'desc' },
  });
};

/**
 * Fetch a single problem in detail with all its relations
 */
export const getProblemById = async (id) => {
  return await prisma.problem.findUnique({
    where: { id },
    include: {
      testcases: true,
      codeSnippets: true,
      solutions: true,
    },
  });
};

/**
 * Create a new problem along with testcases, snippets, and solutions
 */
export const createProblem = async (data) => {
  return await prisma.problem.create({
    data: {
      title: data.title,
      description: data.description,
      difficulty: data.difficulty,
      tags: data.tags,
      companies: data.companies || '',
      timeLimit: data.timeLimit,
      memoryLimit: data.memoryLimit,
      testcases: {
        create: data.testcases.map((tc) => ({
          input: tc.input,
          expectedOutput: tc.expectedOutput,
          isSample: tc.isSample,
        })),
      },
      codeSnippets: {
        create: data.codeSnippets.map((cs) => ({
          language: cs.language,
          codeTemplate: cs.codeTemplate,
        })),
      },
      solutions: {
        create: data.solutions.map((sol) => ({
          language: sol.language,
          solutionCode: sol.solutionCode,
        })),
      },
    },
    include: {
      testcases: true,
      codeSnippets: true,
      solutions: true,
    },
  });
};

/**
 * Update an existing problem, replacing related entities inside a transaction
 */
export const updateProblem = async (id, data) => {
  return await prisma.$transaction(async (tx) => {
    // 1. Delete associated data if replacements are provided
    if (data.testcases) {
      await tx.testcase.deleteMany({ where: { problemId: id } });
    }
    if (data.codeSnippets) {
      await tx.codeSubs.deleteMany({ where: { problemId: id } });
    }
    if (data.solutions) {
      await tx.solution.deleteMany({ where: { problemId: id } });
    }

    // 2. Update parent and insert new relations
    return await tx.problem.update({
      where: { id },
      data: {
        title: data.title,
        description: data.description,
        difficulty: data.difficulty,
        tags: data.tags,
        companies: data.companies,
        timeLimit: data.timeLimit,
        memoryLimit: data.memoryLimit,
        testcases: data.testcases
          ? {
              create: data.testcases.map((tc) => ({
                input: tc.input,
                expectedOutput: tc.expectedOutput,
                isSample: tc.isSample,
              })),
            }
          : undefined,
        codeSnippets: data.codeSnippets
          ? {
              create: data.codeSnippets.map((cs) => ({
                language: cs.language,
                codeTemplate: cs.codeTemplate,
              })),
            }
          : undefined,
        solutions: data.solutions
          ? {
              create: data.solutions.map((sol) => ({
                language: sol.language,
                solutionCode: sol.solutionCode,
              })),
            }
          : undefined,
      },
      include: {
        testcases: true,
        codeSnippets: true,
        solutions: true,
      },
    });
  });
};

/**
 * Delete a problem (associated records will cascade delete)
 */
export const deleteProblem = async (id) => {
  return await prisma.problem.delete({
    where: { id },
  });
};
