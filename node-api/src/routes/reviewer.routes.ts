import { Router } from 'express';
import { reviewerController } from '../controllers/reviewer.controller';
import { requireAuth, requireAnyRole } from '../middleware/rbac';

export const reviewerRouter = Router();

// 1. Reviewer assignments queue (Reviewer and Admin)
reviewerRouter.get(
  '/assignments',
  requireAuth,
  requireAnyRole('admin', 'reviewer'),
  (req, res, next) => {
    reviewerController.getAssignments(req, res, next);
  }
);

// 2. Reviewer verification details (Reviewer and Admin)
reviewerRouter.get(
  '/assignments/:verificationId',
  requireAuth,
  requireAnyRole('admin', 'reviewer'),
  (req, res, next) => {
    reviewerController.getAssignmentDetails(req, res, next);
  }
);

// 3. Reviewer decision submission (Reviewer and Admin)
reviewerRouter.post(
  '/assignments/:verificationId/decision',
  requireAuth,
  requireAnyRole('admin', 'reviewer'),
  (req, res, next) => {
    reviewerController.submitDecision(req, res, next);
  }
);
