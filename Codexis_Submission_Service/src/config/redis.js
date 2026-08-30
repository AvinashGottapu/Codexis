import Redis from 'ioredis';
import dotenv from 'dotenv';

dotenv.config();

const REDIS_HOST = process.env.REDIS_HOST || 'localhost';
const REDIS_PORT = parseInt(process.env.REDIS_PORT || '6379', 10);

// Create a standard Redis client shared across service operations
export const redisClient = new Redis({
  host: REDIS_HOST,
  port: REDIS_PORT,
  // 🛡️ Global Reconnection Retry Strategy (max 5 attempts)
  retryStrategy(times) {
    if (times > 5) {
      console.error(`[Redis] Max reconnection attempts (5) reached. Failing connection.`);
      return null; // Stop retrying and throw error
    }
    const delay = Math.min(times * 1000, 5000); // 1s, 2s, 3s, 4s, 5s
    console.warn(`[Redis] Connection lost. Reconnecting attempt ${times} in ${delay}ms...`);
    return delay;
  }
});

redisClient.on('error', (err) => {
  console.error('[Redis Client] Connection error:', err.message || err);
});
