import { prisma } from '../config/db.js';

export const registerSocketHandlers = (io, socket) => {
  console.log(`[Socket] Client connected: ${socket.id}`);

  // Handle client joining a room for a specific submission with authentication check
  socket.on('joinSubmission', async (submissionId) => {
    try {
      const callerUserId = socket.user?.userId;
      if (!callerUserId) {
        console.warn(`[Socket] Unauthenticated socket ${socket.id} tried to join room: ${submissionId}`);
        return socket.emit('error', 'Authentication required to join submission room');
      }

      // Case 1: Run-Only Submissions (starts with "run-")
      // Formatted as: run-[userId]-[uuid]
      if (submissionId.startsWith('run-')) {
        const parts = submissionId.split('-');
        const ownerUserId = parts[1]; // Extract the userId from the string

        if (ownerUserId !== callerUserId) {
          console.warn(`[Socket] Blocked user ${callerUserId} from joining run-only room: ${submissionId} (Owner: ${ownerUserId})`);
          return socket.emit('error', 'Unauthorized access to this run');
        }
      } 
      
      // Case 2: Final Submissions (DB checks)
      else {
        const submission = await prisma.submission.findUnique({
          where: { id: submissionId },
          select: { userId: true }
        });

        if (!submission || submission.userId !== callerUserId) {
          console.warn(`[Socket] Blocked user ${callerUserId} from joining submission room: ${submissionId}`);
          return socket.emit('error', 'Unauthorized access to this submission');
        }
      }

      // Authorization passed! Join the room.
      socket.join(submissionId);
      console.log(`[Socket] Client ${socket.id} (User: ${callerUserId}) successfully joined room: ${submissionId}`);

    } catch (err) {
      console.error(`[Socket] Authorization error on room join:`, err);
      socket.emit('error', 'Internal server authorization error');
    }
  });

  socket.on('disconnect', () => {
    console.log(`[Socket] Client disconnected: ${socket.id}`);
  });
};
