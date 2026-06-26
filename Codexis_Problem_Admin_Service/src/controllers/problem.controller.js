import { z } from 'zod';
import { marked } from 'marked';
import sanitizeHtml from 'sanitize-html';
import * as problemModel from '../models/problem.model.js';

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

/**
 * GET all problems (basic metadata only)
 */
export const getallProblems = async (req, res) => {
  try {
    const problems = await problemModel.getAllProblems();
    return res.json(problems);
  } catch (error) {
    console.error('Controller Error - getProblems:', error);
    return res.status(500).json({ error: 'Failed to fetch problems' });
  }
};

/**
 * GET detailed problem by ID (including rendered HTML description)
 */
export const getProblem = async (req, res) => {
  const { id } = req.params;
  try {
    const problem = await problemModel.getProblemById(id);
    if (!problem) {
      return res.status(404).json({ error: 'Problem not found' });
    }

    // Convert Markdown description to sanitized HTML
    const renderedDescription = renderDescription(problem.description);

    return res.json({
      ...problem,
      renderedDescription,
    });
  } catch (error) {
    console.error('Controller Error - getProblem:', error);
    return res.status(500).json({ error: 'Failed to fetch problem details' });
  }
};

/**
 * POST create a new problem
 */
export const createProblem = async (req, res) => {
  try {
    // Validate schema
    const validatedData = createProblemSchema.parse(req.body);
    
    // Call model to insert
    const newProblem = await problemModel.createProblem(validatedData);
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
 */
export const updateProblem = async (req, res) => {
  const { id } = req.params;
  try {
    // Validate updated fields
    const validatedData = updateProblemSchema.parse(req.body);
    
    // Call model to update
    const updated = await problemModel.updateProblem(id, validatedData);
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
 */
export const removeProblem = async (req, res) => {
  const { id } = req.params;
  try {
    await problemModel.deleteProblem(id);
    return res.json({ message: 'Problem deleted successfully' });
  } catch (error) {
    console.error('Controller Error - remove:', error);
    return res.status(500).json({ error: 'Failed to delete problem' });
  }
};
