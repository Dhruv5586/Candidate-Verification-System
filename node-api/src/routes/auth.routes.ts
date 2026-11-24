import { Router } from 'express';
import { authController } from '../controllers/auth.controller';
import { authenticate } from '../middleware/authenticate';

export const authRouter = Router();

/**
 * GET /api/v1/auth/me
 * Retrieves current authenticated user context and active session metadata.
 */
authRouter.get('/me', authenticate, (req, res, next) => {
  authController.getMe(req, res, next);
});

/**
 * GET /api/v1/auth/users
 * Returns list of active users and roles for UI role selection.
 */
authRouter.get('/users', (req, res, next) => {
  authController.getUsers(req, res, next);
});

/**
 * POST /api/v1/auth/dev-session
 * Generates an active session for local testing and UI preview.
 */
authRouter.post('/dev-session', (req, res, next) => {
  authController.createDevSession(req, res, next);
});

/**
 * POST /api/v1/auth/logout
 * Logs out and clears session cookie.
 */
authRouter.post('/logout', (req, res, next) => {
  authController.logout(req, res, next);
});
