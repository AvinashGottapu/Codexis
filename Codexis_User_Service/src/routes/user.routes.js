import express from 'express';
import { handleClerkWebhook } from '../controllers/user.controller.js';
import { verifyClerkWebhook } from '../middleware/webhook.middleware.js';

const router = express.Router();

// Public webhook route (called by Clerk Cloud Events)
router.post('/webhooks/clerk', verifyClerkWebhook, handleClerkWebhook);

export default router;
