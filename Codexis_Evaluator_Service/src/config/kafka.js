import { Kafka } from 'kafkajs';
import dotenv from 'dotenv';

dotenv.config();

const KAFKA_BROKERS = process.env.KAFKA_BROKERS || 'localhost:9092,localhost:9093';

const kafka = new Kafka({
  clientId: 'evaluator-service',
  brokers: KAFKA_BROKERS.split(','),
  retry: {
    initialRetryTime: 500, // wait 500ms on first retry
    retries: 5,            // retry up to 5 times (exponential backoff)
    factor: 2,             // double the delay on each attempt (0.5s, 1s, 2s, 4s, 8s)
  }
});

export const producer = kafka.producer();
export const consumer = kafka.consumer({ groupId: 'eval-group' });

export const connectKafka = async () => {
  try {
    await producer.connect();
    console.log('[Kafka Producer] Connected successfully in Evaluator Service to brokers:', KAFKA_BROKERS);

    await consumer.connect();
    console.log('[Kafka Consumer] Connected successfully in Evaluator Service (eval-group)');
  } catch (err) {
    console.error('[Kafka] Connection error in Evaluator Service:', err.message || err);
  }
};
