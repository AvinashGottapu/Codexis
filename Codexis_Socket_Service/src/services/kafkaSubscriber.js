import { consumer } from '../config/kafka.js';

export const initKafkaSubscriber = async (io) => {
  try {
    // Subscribe to results topic
    await consumer.subscribe({ topic: 'submission-results', fromBeginning: false });

    // Listen for messages and relay them to socket.io rooms
    await consumer.run({
      eachMessage: async ({ topic, partition, message }) => {
        try {
          const data = JSON.parse(message.value.toString());
          const { submissionId, status } = data;
          console.log(`[Socket - Kafka] Relaying update for submission ${submissionId} -> Status: ${status}`);

          // Emit to the client connected to this submission's room
          io.to(submissionId).emit('submission:status', data);
        } catch (err) {
          console.error('[Socket - Kafka] Error parsing result message:', err.message || err);
        }
      },
    });
    console.log('[Socket - Kafka] Consumer is running and listening to topic: submission-results');
  } catch (err) {
    console.error('[Socket - Kafka] Failed to subscribe or run consumer:', err.message || err);
  }
};
