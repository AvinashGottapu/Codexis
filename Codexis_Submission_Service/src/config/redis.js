import Redis from 'ioredis';
import dotenv from 'dotenv';

dotenv.config();

const REDIS_HOST = process.env.REDIS_HOST || 'localhost';
const REDIS_PORT = parseInt(process.env.REDIS_PORT || '6379', 10);

// Create a standard Redis client shared across service operations
export const redisClient = new Redis({
  host: REDIS_HOST,
  port: REDIS_PORT,
});
