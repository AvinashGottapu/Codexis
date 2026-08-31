import { createResilientClient } from '../utils/resilientClientFactory.js';
import dotenv from 'dotenv';

dotenv.config();

const PROBLEM_ADMIN_SERVICE_URL = process.env.PROBLEM_ADMIN_SERVICE_URL || 'http://localhost:3001';

// Create a circuit-breaker protected client for Problem Admin Service
export const problemAdminService = createResilientClient(
  'Problem Admin Service',
  PROBLEM_ADMIN_SERVICE_URL
);
