import { Router } from 'express';
import { candidateController } from '../controllers/candidate.controller';
import { requireAuth } from '../middleware/rbac';

export const resumeRouter = Router();

// Resume metadata, extraction, and validation issues
resumeRouter.get('/:documentId', requireAuth, (req, res, next) => {
  candidateController.getResumeById(req, res, next);
});

// Secure stream download
resumeRouter.get('/:documentId/download', requireAuth, (req, res, next) => {
  candidateController.downloadResume(req, res, next);
});
