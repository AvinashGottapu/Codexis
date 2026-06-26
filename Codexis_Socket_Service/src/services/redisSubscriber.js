import { redisSubscriber } from '../config/redis.js';

export const initRedisSubscriber = (io) => {
  // Subscribe to submission channel
  redisSubscriber.subscribe('submission:update', (err, count) => {
    if (err) {
      console.error('[Socket] Failed to subscribe to Redis channel:', err);
    } else {
      console.log(`[Socket] Subscribed to Redis channel 'submission:update' (${count} channel(s))`);
    }
  });

  // Relay incoming messages from Redis to matching Socket.IO rooms
  redisSubscriber.on('message', (channel, message) => {
    if (channel === 'submission:update') {
      try {
        const data = JSON.parse(message);
        const { submissionId, status } = data;
        console.log(`[Socket] Received Redis update for submission ${submissionId}: ${status}`);

        // Emit to the socket room matching this submission ID
        io.to(submissionId).emit('submission:status', data);
      } catch (err) {
        console.error('[Socket] Failed to parse Redis Pub/Sub message:', err);
      }
    }
  });
};
