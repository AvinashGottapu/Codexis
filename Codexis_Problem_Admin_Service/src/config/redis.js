import Redis from 'ioredis';
import dotenv from 'dotenv';

dotenv.config();

const REDIS_HOST = process.env.REDIS_HOST || 'localhost';
const REDIS_PORT = parseInt(process.env.REDIS_PORT || '6379', 10);

export const redis = new Redis({
  host: REDIS_HOST,
  port: REDIS_PORT,
});

redis.on('connect', () => {
  console.log('[Redis] Connected to Redis server successfully.');
});

redis.on('error', (err) => {
  console.error('[Redis] Connection error:', err);
});
