import { Kafka } from 'kafkajs';
import dotenv from 'dotenv';

dotenv.config();

const KAFKA_BROKERS = process.env.KAFKA_BROKERS || 'localhost:9092,localhost:9093';

export const kafka = new Kafka({
  clientId: 'submission-service',
  brokers: KAFKA_BROKERS.split(','),
  retry: {
    initialRetryTime: 500, // wait 500ms on first retry
    retries: 5,            // retry up to 5 times (exponential backoff)
    factor: 2,             // double the delay on each attempt (0.5s, 1s, 2s, 4s, 8s)
  }
});

export const producer = kafka.producer();
export const consumer = kafka.consumer({ groupId: 'db-sync-group' });

export const initializeTopics = async () => {
  const admin = kafka.admin();
  try {
    await admin.connect();
    console.log('[Kafka Admin] Connecting to verify topics...');
    
    // Explicitly create topics with 2 partitions and replication factor of 2
    await admin.createTopics({
      validateOnly: false,
      waitForLeaders: true,
      topics: [
        {
          topic: 'submission-tasks',
          numPartitions: 2,
          replicationFactor: 2,
        },
        {
          topic: 'submission-results',
          numPartitions: 2,
          replicationFactor: 2,
        },
        {
          topic: 'submission-tasks-dlq',
          numPartitions: 2,
          replicationFactor: 2,
        },
      ],
    });
    console.log('[Kafka Admin] Topics verified/created successfully (2 Partitions, 2 Replicas)');
  } catch (err) {
    console.error('[Kafka Admin] Failed to initialize topics:', err.message || err);
  } finally {
    await admin.disconnect();
  }
};

export const connectKafka = async () => {
  try {
    await producer.connect();
    console.log('[Kafka Producer] Connected successfully to brokers:', KAFKA_BROKERS);
    await consumer.connect();
    console.log('[Kafka Consumer] Connected successfully (db-sync-group)');
  } catch (err) {
    console.error('[Kafka] Connection failed:', err.message || err);
  }
};
