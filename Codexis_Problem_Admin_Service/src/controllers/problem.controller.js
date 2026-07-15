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
const ALL_PROBLEMS_TTL = 3600;      // 1 hour
const SINGLE_PROBLEM_TTL = 86400;   // 24 hours

/**
 * GET all problems (basic metadata only)
 * Cache-Aside with Sliding Expiration
 */
export const getallProblems = async (req, res) => {
  const cacheKey = 'cache:problems:all';
  try {
    // 1. Check Redis Cache
    const cachedData = await redis.get(cacheKey);
    if (cachedData) {
      console.log('[Cache] HIT - getallProblems');
      
      // Sliding Expiration: Reset the TTL back to 1 hour upon access
      await redis.expire(cacheKey, ALL_PROBLEMS_TTL);
      
      return res.json(JSON.parse(cachedData));
    }

    console.log('[Cache] MISS - getallProblems. Fetching from database...');
    // 2. Fetch from Postgres
    const problems = await problemModel.getAllProblems();
    
    // 3. Save to Redis Cache
    await redis.setex(cacheKey, ALL_PROBLEMS_TTL, JSON.stringify(problems));
    // Stringify Bcz Redis can only store the strings...

    return res.json(problems);
  } catch (error) {
    console.error('Controller Error - getProblems:', error);
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

    // Active Cache Invalidation: Delete the cached list of all problems
    await redis.del('cache:problems:all');
    console.log('[Cache] INVALIDATED - cache:problems:all (New problem created)');

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

    // Active Cache Invalidation: Clear relevant caches so users see the updates instantly
    await redis.del('cache:problems:all');
    await redis.del(`cache:problem:${id}`);
    console.log(`[Cache] INVALIDATED - cache:problems:all and cache:problem:${id} (Problem updated)`);

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

    // Active Cache Invalidation: Delete from cache
    await redis.del('cache:problems:all');
    await redis.del(`cache:problem:${id}`);
    console.log(`[Cache] INVALIDATED - cache:problems:all and cache:problem:${id} (Problem deleted)`);

    return res.json({ message: 'Problem deleted successfully' });
  } catch (error) {
    console.error('Controller Error - remove:', error);
    return res.status(500).json({ error: 'Failed to delete problem' });
  }
};
