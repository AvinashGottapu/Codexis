import express from 'express';
import dotenv from 'dotenv';
import problemRouter from './routes/problem.routes.js';

dotenv.config();

const app = express();
const PORT = process.env.PORT || 3001;

// Global Middlewares
app.use(express.json());

// CORS Middleware
app.use((req, res, next) => {
  res.header('Access-Control-Allow-Origin', '*');
  res.header('Access-Control-Allow-Headers', 'Origin, X-Requested-With, Content-Type, Accept');
  res.header('Access-Control-Allow-Methods', 'GET, POST, PUT, DELETE, OPTIONS');
  if (req.method === 'OPTIONS') {
    return res.sendStatus(200);
  }
  next();
});

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
