import fs from 'fs';
import path from 'path';
import { kafka } from '../config/kafka.js';

const consumer = kafka.consumer({ groupId: 'dlq-audit-group' });
const LOG_FILE = path.join(process.cwd(), 'logs', 'dlq-audit.log');

export const initDlqConsumer = async () => {
  try {
    await consumer.connect();
    await consumer.subscribe({ topic: 'submission-tasks-dlq', fromBeginning: true });

    console.log('[DLQ Auditor] Consumer listening to topic: submission-tasks-dlq...');

    // Ensure logs directory exists
    if (!fs.existsSync(path.dirname(LOG_FILE))) {
      fs.mkdirSync(path.dirname(LOG_FILE), { recursive: true });
    }

    await consumer.run({
      eachMessage: async ({ message }) => {
        try {
          const payload = JSON.parse(message.value.toString());
          
          const logEntry = `
=========================================
[DLQ ALERT] Poison Pill Detected!
Timestamp: ${payload.crashedAt}
Submission ID: ${payload.submissionId}
User ID: ${payload.userId}
Problem ID: ${payload.problemId}
Language: ${payload.language}
Attempts: ${payload.attempts}
-----------------------------------------
TOXIC CODE:
${payload.code}
=========================================\n`;

          // Write the toxic code to the audit log file
          fs.appendFileSync(LOG_FILE, logEntry);
          console.warn(`[DLQ Auditor] ALERT: Poison pill ${payload.submissionId} logged to logs/dlq-audit.log`);
        } catch (parseErr) {
          console.error('[DLQ Auditor] Failed to process DLQ message:', parseErr.message || parseErr);
        }
      }
    });
  } catch (err) {
    console.error('[DLQ Auditor] Initialization error:', err.message || err);
  }
};
