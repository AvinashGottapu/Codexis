import Redis from 'ioredis';
import dotenv from 'dotenv';

dotenv.config();

const REDIS_HOST = process.env.REDIS_HOST || 'localhost';
const REDIS_PORT = parseInt(process.env.REDIS_PORT || '6379', 10);

const redis = new Redis({
  host: REDIS_HOST,
  port: REDIS_PORT,
});

// Configuration for rate limits
const LIMITS = {
  run: {
    max: 10,               // 10 runs
    windowMs: 60 * 1000,   // per 60 seconds
    label: 'code run'
  },
  submit: {
    max: 5,                // 5 final submissions
    windowMs: 60 * 1000,   // per 60 seconds
    label: 'submission'
  }
};

/**
 * Sliding Window Rate Limiter using Redis Sorted Sets (ZSET)
 */
export const rateLimiter = async (request, reply) => {
  try {
    const userId = request.user?.userId || request.ip;
    const body = request.body || {};
    const isRunOnly = body.isRunOnly === true;
    
    const limitType = isRunOnly ? 'run' : 'submit';
    const limit = LIMITS[limitType];
    
    const key = `rate:${limitType}:${userId}`;
    const now = Date.now();
    const clearBefore = now - limit.windowMs;

    // Use a transaction (multi) to make operations atomic
    const result = await redis
      .multi() // Queue multiple commands. They execute together.
      .zremrangebyscore(key, 0, clearBefore) // remove timestamps outside the current window
      .zcard(key)                            // count elements inside the window
      .exec();

    // zcard result 
    // Redis returns => [ [null, removedCount], [null, currentCount] ]..
    const currentCount = result[1][1];

    if (currentCount >= limit.max) {
      const oldestTimestamp = await redis.zrange(key, 0, 0, 'WITHSCORES');
      let retryAfter = Math.ceil(limit.windowMs / 1000);
      
      if (oldestTimestamp && oldestTimestamp.length > 0) {
        const oldestTime = parseInt(oldestTimestamp[1], 10);
        retryAfter = Math.ceil((oldestTime + limit.windowMs - now) / 1000);
        // How many seconds until the oldest request leaves the sliding window?..
      }
      
      // Ensure positive retryAfter
      retryAfter = retryAfter > 0 ? retryAfter : 1;

      console.warn(`[Rate Limiter] Blocked ${limit.label} for user ${userId}. Count: ${currentCount}/${limit.max}`);
      
      reply.header('Retry-After', retryAfter);
      return reply.status(429).send({
        error: 'Too Many Requests',
        message: `You have exceeded the rate limit for ${limit.label}s. Please try again in ${retryAfter} seconds.`,
        limit: limit.max,
        windowMs: limit.windowMs,
        retryAfter
      });
    }

    // Add current request timestamp to the sorted set and set expiration
    await redis
      .multi()
      .zadd(key, now, `${now}-${Math.random()}`) // use unique value (timestamp + random) to avoid overwriting same-timestamp elements
      .expire(key, Math.ceil(limit.windowMs / 1000))
      // EXPIRE always works on the entire Redis key. It cannot expire individual members inside a Sorted Set.
      .exec();

    console.log(`[Rate Limiter] Allowed ${limit.label} for user ${userId}. Count: ${currentCount + 1}/${limit.max}`);

  } catch (error) {
    console.error('[Rate Limiter Middleware] Error:', error);
    // Fail open if Redis is down so we don't block users completely in production
  }
};
