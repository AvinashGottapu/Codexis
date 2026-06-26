export const registerSocketHandlers = (io, socket) => {
  console.log(`[Socket] Client connected: ${socket.id}`);

  // Handle client joining a room for a specific submission
  socket.on('joinSubmission', (submissionId) => {
    socket.join(submissionId);
    console.log(`[Socket] Client ${socket.id} joined room: ${submissionId}`);
  });

  socket.on('disconnect', () => {
    console.log(`[Socket] Client disconnected: ${socket.id}`);
  });
};
