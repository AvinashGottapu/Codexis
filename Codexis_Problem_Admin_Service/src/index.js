import express from 'express';
import dotenv from 'dotenv';
import problemRouter from './routes/problem.routes.js';

dotenv.config();

const app = express();
const PORT = process.env.PORT || 3001;

// Global Middlewares
app.use(express.json());

// Mount modular routers
app.use('/api/problems', problemRouter);

// Health check endpoint
app.get('/health', (req, res) => {
  res.json({ status: 'ok', service: 'codexis-problem-admin-service' });
});

// Start listening
app.listen(PORT, () => {
  console.log(`[Problem Admin Service] Running on port ${PORT}`);
});
