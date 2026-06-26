import express from 'express';
import { getDashboardRouter } from '../controllers/dashboard.controller.js';

const router = express.Router();

// Mount the Bull Board router at the base path
router.use('/', getDashboardRouter());

export default router;
