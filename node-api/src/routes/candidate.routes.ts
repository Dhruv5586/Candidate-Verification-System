import { Router } from 'express';
import { candidateController } from '../controllers/candidate.controller';
import { verificationController } from '../controllers/verification.controller';
import { requireAuth, requireAnyRole } from '../middleware/rbac';
import { uploadMiddleware } from '../middleware/upload';

export const candidateRouter = Router();

// Candidate CRUD
candidateRouter.post('/', requireAuth, requireAnyRole('admin', 'recruiter'), (req, res, next) => {
  candidateController.createCandidate(req, res, next);
});

candidateRouter.get('/', requireAuth, (req, res, next) => {
  candidateController.getCandidates(req, res, next);
});

// Live dashboard telemetry statistics
candidateRouter.get('/stats', requireAuth, (req, res, next) => {
  candidateController.getStats(req, res, next);
});

candidateRouter.get('/metrics', requireAuth, (req, res, next) => {
  candidateController.getStats(req, res, next);
});

candidateRouter.get('/:id', requireAuth, (req, res, next) => {
  candidateController.getCandidateById(req, res, next);
});

candidateRouter.patch('/:id', requireAuth, requireAnyRole('admin', 'recruiter'), (req, res, next) => {
  candidateController.updateCandidate(req, res, next);
});

candidateRouter.delete('/:id', requireAuth, requireAnyRole('admin', 'recruiter'), (req, res, next) => {
  candidateController.deleteCandidate(req, res, next);
});

// Resume upload & list under candidate
candidateRouter.post(
  '/:id/resumes',
  requireAuth,
  requireAnyRole('admin', 'recruiter'),
  uploadMiddleware.fields([
    { name: 'resume', maxCount: 1 },
    { name: 'file', maxCount: 1 },
  ]),
  (req, res, next) => {
    // Normalize req.file from fields
    if (!req.file && req.files) {
      const filesObj = req.files as { [fieldname: string]: Express.Multer.File[] };
      req.file = filesObj['resume']?.[0] || filesObj['file']?.[0];
    }
    candidateController.uploadResume(req, res, next);
  }
);

candidateRouter.get('/:id/resumes', requireAuth, (req, res, next) => {
  candidateController.getCandidateResumes(req, res, next);
});

// Candidate Claims
candidateRouter.post('/:id/claims', requireAuth, requireAnyRole('admin', 'recruiter'), (req, res, next) => {
  verificationController.addClaim(req, res, next);
});

candidateRouter.get('/:id/claims', requireAuth, (req, res, next) => {
  verificationController.getClaims(req, res, next);
});

// Candidate Verifications (Initiate automated verification workflow)
candidateRouter.post(
  '/:id/verifications',
  requireAuth,
  requireAnyRole('admin', 'recruiter'),
  (req, res, next) => {
    verificationController.initiateCandidateVerification(req, res, next);
  }
);

candidateRouter.get(
  '/:id/verifications',
  requireAuth,
  (req, res, next) => {
    verificationController.getCandidateVerifications(req, res, next);
  }
);
