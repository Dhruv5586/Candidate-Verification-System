import { Router } from 'express';
import { verificationController } from '../controllers/verification.controller';
import { requireAuth, requireRole, requireAnyRole } from '../middleware/rbac';

export const verificationRouter = Router();

// Create verification task (Admin or Recruiter)
verificationRouter.post(
  '/',
  requireAuth,
  requireAnyRole('admin', 'recruiter'),
  (req, res, next) => {
    verificationController.createVerification(req, res, next);
  }
);

// Get verification review queue (Reviewer and Admin only - Recruiters forbidden)
verificationRouter.get(
  '/',
  requireAuth,
  requireAnyRole('admin', 'reviewer'),
  (req, res, next) => {
    verificationController.getQueue(req, res, next);
  }
);

// Phase 9 Step 6: Assign reviewer to verification task (Admin or Recruiter)
verificationRouter.post(
  '/:id/assign',
  requireAuth,
  requireAnyRole('admin', 'recruiter'),
  (req, res, next) => {
    verificationController.assignReviewer(req, res, next);
  }
);

// Reassign reviewer to verification task (Admin only)
verificationRouter.patch(
  '/:id/assign',
  requireAuth,
  requireRole('admin'),
  (req, res, next) => {
    verificationController.assignReviewer(req, res, next);
  }
);

// Submit verification review decision (Reviewer and Admin only)
verificationRouter.post(
  '/:id/review',
  requireAuth,
  requireAnyRole('admin', 'reviewer'),
  (req, res, next) => {
    verificationController.submitReview(req, res, next);
  }
);

// Get validation issues for verification
verificationRouter.get(
  '/:id/issues',
  requireAuth,
  (req, res, next) => {
    verificationController.getVerificationIssues(req, res, next);
  }
);

// Get single verification details
verificationRouter.get(
  '/:id',
  requireAuth,
  (req, res, next) => {
    verificationController.getVerificationById(req, res, next);
  }
);
