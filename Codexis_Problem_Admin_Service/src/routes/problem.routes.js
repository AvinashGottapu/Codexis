import express from 'express';
import {
  getallProblems,
  getProblem,
  createProblem,
  updateProblem,
  removeProblem,
} from '../controllers/problem.controller.js';

const router = express.Router();

// Define router paths and map them to their controller handlers
router.get('/all', getallProblems);
router.get('/get/:id', getProblem);
router.post('/create', createProblem);
router.put('/update/:id', updateProblem);
router.delete('/delete/:id', removeProblem);

export default router;
