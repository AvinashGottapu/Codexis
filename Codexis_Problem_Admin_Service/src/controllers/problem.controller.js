import { z } from 'zod';
import { marked } from 'marked';
import sanitizeHtml from 'sanitize-html';
import * as problemModel from '../models/problem.model.js';
import { redis } from '../config/redis.js';

// Zod schemas for request body validation
const testcaseSchema = z.object({
  id: z.string().optional(),
  input: z.string(),
  expectedOutput: z.string(),
  isSample: z.boolean().default(false),
});

const codeSnippetSchema = z.object({
  id: z.string().optional(),
  language: z.string(),
  codeTemplate: z.string(),
});

const solutionSchema = z.object({
  id: z.string().optional(),
  language: z.string(),
  solutionCode: z.string(),
});

const createProblemSchema = z.object({
  title: z.string().min(1, 'Title is required'),
  description: z.string().min(1, 'Description is required'),
  difficulty: z.enum(['Easy', 'Medium', 'Hard']),
  tags: z.string(),
  companies: z.string().optional().default(''),
  timeLimit: z.number().int().positive().default(2000),
  memoryLimit: z.number().int().positive().default(256),
  testcases: z.array(testcaseSchema).min(1, 'At least one testcase is required'),
  codeSnippets: z.array(codeSnippetSchema).default([]),
  solutions: z.array(solutionSchema).default([]),
});

const updateProblemSchema = createProblemSchema.partial();

// Helper function to render Markdown to clean, sanitized HTML
const renderDescription = (markdown) => {
  const html = marked.parse(markdown);
  return sanitizeHtml(html, {
    allowedTags: sanitizeHtml.defaults.allowedTags.concat(['img', 'pre', 'code']),
    allowedAttributes: {
      ...sanitizeHtml.defaults.allowedAttributes,
      'code': ['class'],
    },
  });
};

// Caching configuration values (in seconds)
const ALL_PROBLEMS_TTL = 604800;   // 7 days
const SINGLE_PROBLEM_TTL = 86400;   // 24 hours

/**
 * GET all problems (basic metadata only)
 * Cache-Aside with Sliding Expiration
 */
export const getallProblems = async (req, res) => {
  const indexKey = 'cache:problems:index';
  try {
    // 1. Parse pagination queries
    const page = parseInt(req.query.page, 10) || 1;
    const limit = parseInt(req.query.limit, 10) || 20;

    if (page < 1 || limit < 1) {
      return res.status(400).json({ error: 'Invalid page or limit parameter' });
    }

    // 2. Rebuild the ZSET index if it doesn't exist
    const indexExists = await redis.exists(indexKey);
    if (!indexExists) {
      console.log('[Cache] Index MISS - Rebuilding ZSET index and seeding entities...');
      const allProblems = await problemModel.getAllProblems();

      if (allProblems.length > 0) {
        const pipeline = redis.pipeline();
        allProblems.forEach((problem) => {
          const score = new Date(problem.createdAt).getTime();
          pipeline.zadd(indexKey, score, problem.id);
          pipeline.setex(`cache:problem:metadata:${problem.id}`, ALL_PROBLEMS_TTL, JSON.stringify(problem));
        });
        pipeline.expire(indexKey, ALL_PROBLEMS_TTL);
        await pipeline.exec();
      }
    } else {
      // Sliding expiration: prolong the index TTL
      await redis.expire(indexKey, ALL_PROBLEMS_TTL);
    }

    // 3. Query ZSET for the problem IDs of the requested page
    const totalProblems = await redis.zcard(indexKey);
    const totalPages = Math.ceil(totalProblems / limit) || 1;

    const offset = (page - 1) * limit;
    const start = offset;
    const end = offset + limit - 1;

    // Fetch problem IDs (newest first - ZREVRANGE)
    const problemIds = await redis.zrevrange(indexKey, start, end);

    if (problemIds.length === 0) {
      return res.json({
        problems: [],
        pagination: {
          totalProblems,
          totalPages,
          currentPage: page,
          limit,
        },
      });
    }

    // 4. Multi-get the individual cached problems
    const entityKeys = problemIds.map((id) => `cache:problem:metadata:${id}`);
    const cachedProblems = await redis.mget(entityKeys);

    const missingIds = [];
    const resultProblems = [];

    for (let i = 0; i < problemIds.length; i++) {
      const data = cachedProblems[i];
      if (data) {
        resultProblems.push(JSON.parse(data));
      } else {
        missingIds.push(problemIds[i]);
        resultProblems.push(null);
      }
    }

    // 5. Fetch any missing entities from Postgres and cache them
    if (missingIds.length > 0) {
      console.log(`[Cache] Entity MISS - Fetching ${missingIds.length} missing problems from database...`);
      const dbProblems = await problemModel.getProblemsByIds(missingIds);
      const dbProblemsMap = new Map(dbProblems.map((p) => [p.id, p]));

      const pipeline = redis.pipeline();
      for (let i = 0; i < problemIds.length; i++) {
        if (resultProblems[i] === null) {
          const id = problemIds[i];
          const dbProblem = dbProblemsMap.get(id);
          if (dbProblem) {
            resultProblems[i] = dbProblem;
            pipeline.setex(`cache:problem:metadata:${id}`, ALL_PROBLEMS_TTL, JSON.stringify(dbProblem));
          }
        }
      }
      await pipeline.exec();
    }

    // Filter out any null/deleted problems
    const cleanProblems = resultProblems.filter((p) => p !== null);

    return res.json({
      problems: cleanProblems,
      pagination: {
        totalProblems,
        totalPages,
        currentPage: page,
        limit,
      },
    });
  } catch (error) {
    console.error('Controller Error - getallProblems:', error);
    return res.status(500).json({ error: 'Failed to fetch problems' });
  }
};

/**
 * GET detailed problem by ID (including rendered HTML description)
 * Cache-Aside with Sliding Expiration
 */
export const getProblem = async (req, res) => {
  const { id } = req.params;
  const cacheKey = `cache:problem:${id}`;
  try {
    // 1. Check Redis Cache
    const cachedData = await redis.get(cacheKey);
    if (cachedData) {
      console.log(`[Cache] HIT - getProblem:${id}`);
      
      // Sliding Expiration: Reset the TTL back to 24 hours upon access
      await redis.expire(cacheKey, SINGLE_PROBLEM_TTL);
      
      return res.json(JSON.parse(cachedData));
    }

    console.log(`[Cache] MISS - getProblem:${id}. Fetching from database...`);
    // 2. Fetch from Postgres
    const problem = await problemModel.getProblemById(id);
    if (!problem) {
      return res.status(404).json({ error: 'Problem not found' });
    }

    // Convert Markdown description to sanitized HTML
    const renderedDescription = renderDescription(problem.description);
    const problemDetails = {
      ...problem,
      renderedDescription,
    };

    // 3. Save to Redis Cache
    await redis.setex(cacheKey, SINGLE_PROBLEM_TTL, JSON.stringify(problemDetails));

    return res.json(problemDetails);
  } catch (error) {
    console.error('Controller Error - getProblem:', error);
    return res.status(500).json({ error: 'Failed to fetch problem details' });
  }
};

/**
 * POST create a new problem
 * Active Cache Invalidation: Invalidate all problems cache
 */
export const createProblem = async (req, res) => {
  try {
    // Validate schema
    const validatedData = createProblemSchema.parse(req.body);

    // Call model to insert
    const newProblem = await problemModel.createProblem(validatedData);

    // Sync Cache: Add to ZSET index and cache the individual metadata
    const score = new Date(newProblem.createdAt).getTime();
    await redis.zadd('cache:problems:index', score, newProblem.id);

    const basicMetadata = {
      id: newProblem.id,
      title: newProblem.title,
      difficulty: newProblem.difficulty,
      tags: newProblem.tags,
      companies: newProblem.companies || '',
      timeLimit: newProblem.timeLimit,
      memoryLimit: newProblem.memoryLimit,
      createdAt: newProblem.createdAt,
      updatedAt: newProblem.updatedAt,
    };
    await redis.setex(`cache:problem:metadata:${newProblem.id}`, ALL_PROBLEMS_TTL, JSON.stringify(basicMetadata));

    console.log(`[Cache] UPDATED - Added new problem ${newProblem.id} to ZSET index and cached metadata`);

    return res.status(201).json(newProblem);
  } catch (error) {
    if (error instanceof z.ZodError) {
      return res.status(400).json({ error: 'Validation error', details: error.errors });
    }
    console.error('Controller Error - create:', error);
    return res.status(500).json({ error: 'Failed to create problem' });
  }
};

/**
 * PUT update an existing problem
 * Active Cache Invalidation: Delete both the problem list cache and individual problem cache
 */
export const updateProblem = async (req, res) => {
  const { id } = req.params;
  try {
    // Validate updated fields
    const validatedData = updateProblemSchema.parse(req.body);

    // Call model to update
    const updated = await problemModel.updateProblem(id, validatedData);

    // Active Cache Invalidation & Sync: Clear detailed view and update metadata
    await redis.del(`cache:problem:${id}`);

    // Active Cache Invalidation: Clear dependent execution caches indexed under this problem
    try {
      const submissionsIndexKey = `cache:problem:submissions:${id}`;
      const cachedKeys = await redis.smembers(submissionsIndexKey);
      if (cachedKeys.length > 0) {
        await redis.unlink(...cachedKeys, submissionsIndexKey);
        console.log(`[Cache Invalidation] Successfully cleared ${cachedKeys.length} cached solutions for problem ${id}`);
      }
    } catch (cacheErr) {
      console.error('[Cache Error] Failed to invalidate execution caches:', cacheErr.message);
    }

    const basicMetadata = {
      id: updated.id,
      title: updated.title,
      difficulty: updated.difficulty,
      tags: updated.tags,
      companies: updated.companies || '',
      timeLimit: updated.timeLimit,
      memoryLimit: updated.memoryLimit,
      createdAt: updated.createdAt,
      updatedAt: updated.updatedAt,
    };
    await redis.setex(`cache:problem:metadata:${id}`, ALL_PROBLEMS_TTL, JSON.stringify(basicMetadata));

    // Keep ZSET score in sync (newest first)
    const score = new Date(updated.createdAt).getTime();
    await redis.zadd('cache:problems:index', score, id);

    console.log(`[Cache] UPDATED - metadata cache and ZSET index score for ${id}`);

    return res.json(updated);
  } catch (error) {
    if (error instanceof z.ZodError) {
      return res.status(400).json({ error: 'Validation error', details: error.errors });
    }
    console.error('Controller Error - update:', error);
    return res.status(500).json({ error: 'Failed to update problem' });
  }
};

/**
 * DELETE a problem by ID
 * Active Cache Invalidation: Delete both cache keys
 */
export const removeProblem = async (req, res) => {
  const { id } = req.params;
  try {
    await problemModel.deleteProblem(id);

    // Active Cache Invalidation: Delete from ZSET index and all caches
    await redis.zrem('cache:problems:index', id);
    await redis.del(`cache:problem:${id}`);
    await redis.del(`cache:problem:metadata:${id}`);

    // Active Cache Invalidation: Clear dependent execution caches indexed under this problem
    try {
      const submissionsIndexKey = `cache:problem:submissions:${id}`;
      const cachedKeys = await redis.smembers(submissionsIndexKey);
      if (cachedKeys.length > 0) {
        await redis.unlink(...cachedKeys, submissionsIndexKey);
        console.log(`[Cache Invalidation] Successfully cleared ${cachedKeys.length} cached solutions for problem ${id}`);
      }
    } catch (cacheErr) {
      console.error('[Cache Error] Failed to invalidate execution caches:', cacheErr.message);
    }
    console.log(`[Cache] DELETED - Removed problem ${id} from ZSET index and cleared caches`);

    return res.json({ message: 'Problem deleted successfully' });
  } catch (error) {
    console.error('Controller Error - remove:', error);
    return res.status(500).json({ error: 'Failed to delete problem' });
  }
};
