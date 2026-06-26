import express from 'express';
import cors from 'cors';
import dotenv from 'dotenv';
import userRouter from './routes/user.routes.js';

dotenv.config();

const app = express();
const PORT = process.env.PORT || 3005;

// Global Middlewares
app.use(cors({ origin: '*' }));

// Clerk Webhooks require the raw body, so we check if the path is the webhook route before parsing JSON
app.use((req, res, next) => {
  if (req.originalUrl === '/api/user/webhooks/clerk') {
    // Read raw body for Svix signature verification
    let data = '';
    req.setEncoding('utf8');
    req.on('data', (chunk) => {
      data += chunk;
    });
    req.on('end', () => {
      req.body = data;
      next();
    });
  } else {
    express.json()(req, res, next);
  }
});

// Mount routes
app.use('/api/user', userRouter);

// Health check endpoint
app.get('/health', (req, res) => {
  res.json({ status: 'ok', service: 'codexis-user-service' });
});

// Start Server
app.listen(PORT, () => {
  console.log(`[User Service] Running on port ${PORT}`);
});
