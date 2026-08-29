import { Kafka } from 'kafkajs';
import dotenv from 'dotenv';

dotenv.config();

const KAFKA_BROKERS = process.env.KAFKA_BROKERS || 'localhost:9092,localhost:9093';

const kafka = new Kafka({
  clientId: 'socket-service',
  brokers: KAFKA_BROKERS.split(','),
});

export const consumer = kafka.consumer({ groupId: 'websocket-stream-group' });

export const connectKafka = async () => {
  try {
    await consumer.connect();
    console.log('[Kafka Consumer] Connected successfully in Socket Service to brokers:', KAFKA_BROKERS);
  } catch (err) {
    console.error('[Kafka] Connection error in Socket Service:', err.message || err);
  }
};
