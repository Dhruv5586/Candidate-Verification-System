import { Request, Response, NextFunction } from 'express';
import { UnauthorizedError, ForbiddenError, ServiceUnavailableError } from '../utils/errors';
import { authenticate } from './authenticate';
import { userRoleRepository } from '../repositories/userRole.repository';
import { AppRole, APP_ROLES } from '../types/rbac.types';
import { logger } from '../utils/logger';

/**
 * requireAuth middleware ensures an authenticated user context is present on the request.
 * Chains directly with the Phase 6 session authentication middleware.
 */
export const requireAuth = authenticate;

/**
 * requireRole middleware enforces that the authenticated user possesses the specified role.
 * 1. Checks that req.user exists (401 if missing).
 * 2. Refreshes/verifies roles from PostgreSQL (or verified context).
 * 3. Returns 403 Forbidden if user does not possess the required role.
 */
export function requireRole(requiredRole: AppRole) {
  return async (req: Request, _res: Response, next: NextFunction): Promise<void> => {
    try {
      if (!req.user) {
        throw new UnauthorizedError('Authentication required: no active user context');
      }

      const userId = req.user.id;
      let roles: AppRole[] = [];

      try {
        roles = await userRoleRepository.getUserRoles(userId);
      } catch (dbErr: any) {
        logger.error({ err: dbErr.message, userId }, 'Database failure during role authorization check');
        throw new ServiceUnavailableError('Authorization database check failed');
      }

      // If user has no roles in DB but had roles from auth context, allow if matched or sync
      if (roles.length === 0 && req.user.roles && req.user.roles.length > 0) {
        roles = req.user.roles as AppRole[];
      }

      // Update user context with fresh roles
      req.user.roles = roles;

      if (!roles.includes(requiredRole)) {
        logger.warn(
          { userId, requiredRole, currentRoles: roles },
          'Access forbidden: user lacks required role'
        );
        throw new ForbiddenError(
          `Access forbidden: requires '${requiredRole}' role`
        );
      }

      next();
    } catch (err) {
      next(err);
    }
  };
}

/**
 * requireAnyRole middleware enforces that the user possesses at least one of the allowed roles.
 */
export function requireAnyRole(...allowedRoles: AppRole[]) {
  return async (req: Request, _res: Response, next: NextFunction): Promise<void> => {
    try {
      if (!req.user) {
        throw new UnauthorizedError('Authentication required: no active user context');
      }

      const userId = req.user.id;
      let roles: AppRole[] = [];

      try {
        roles = await userRoleRepository.getUserRoles(userId);
      } catch (dbErr: any) {
        logger.error({ err: dbErr.message, userId }, 'Database failure during role authorization check');
        throw new ServiceUnavailableError('Authorization database check failed');
      }

      if (roles.length === 0 && req.user.roles && req.user.roles.length > 0) {
        roles = req.user.roles as AppRole[];
      }

      req.user.roles = roles;

      const hasAllowedRole = allowedRoles.some((r) => roles.includes(r));
      if (!hasAllowedRole) {
        logger.warn(
          { userId, allowedRoles, currentRoles: roles },
          'Access forbidden: user lacks any of the permitted roles'
        );
        throw new ForbiddenError(
          `Access forbidden: requires one of [${allowedRoles.join(', ')}] roles`
        );
      }

      next();
    } catch (err) {
      next(err);
    }
  };
}
