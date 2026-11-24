import { Router } from 'express';
import { rbacController } from '../controllers/rbac.controller';
import { requireAuth, requireRole } from '../middleware/rbac';

export const rbacRouter = Router();

// Protected Admin test route
rbacRouter.get('/admin', requireAuth, requireRole('admin'), (req, res, next) => {
  rbacController.getAdmin(req, res, next);
});

// Protected Recruiter test route
rbacRouter.get('/recruiter', requireAuth, requireRole('recruiter'), (req, res, next) => {
  rbacController.getRecruiter(req, res, next);
});

// Protected Reviewer test route
rbacRouter.get('/reviewer', requireAuth, requireRole('reviewer'), (req, res, next) => {
  rbacController.getReviewer(req, res, next);
});

// Admin-only role assignment endpoint
rbacRouter.post('/roles/assign', requireAuth, requireRole('admin'), (req, res, next) => {
  rbacController.assignRole(req, res, next);
});
