import { Request, Response, NextFunction } from 'express';
import { roleService } from '../services/role.service';
import { AppRole, APP_ROLES } from '../types/rbac.types';
import { BadRequestError, UnauthorizedError } from '../utils/errors';
import { ApiResponse } from '../types/api.types';

export class RbacController {
  /**
   * GET /api/v1/rbac/admin
   * Safe information about the authenticated user and authorized admin role.
   */
  public async getAdmin(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      if (!req.user) {
        throw new UnauthorizedError('No authenticated user context');
      }

      const response: ApiResponse = {
        success: true,
        data: {
          user: {
            id: req.user.id,
            email: req.user.email,
            name: req.user.name,
            roles: req.user.roles,
          },
          authorizedRole: 'admin',
          permissions: [
            'view_users',
            'assign_roles',
            'change_roles',
            'view_all_candidates',
            'manage_verification_assignments',
            'view_audit_logs',
          ],
        },
        meta: {
          timestamp: new Date().toISOString(),
          version: 'v1',
        },
      };

      res.status(200).json(response);
    } catch (err) {
      next(err);
    }
  }

  /**
   * GET /api/v1/rbac/recruiter
   * Safe information about the authenticated user and authorized recruiter role.
   */
  public async getRecruiter(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      if (!req.user) {
        throw new UnauthorizedError('No authenticated user context');
      }

      const response: ApiResponse = {
        success: true,
        data: {
          user: {
            id: req.user.id,
            email: req.user.email,
            name: req.user.name,
            roles: req.user.roles,
          },
          authorizedRole: 'recruiter',
          permissions: [
            'create_candidates',
            'view_authorized_candidates',
            'update_authorized_candidates',
            'upload_resumes',
            'start_verification',
            'view_verification_status',
          ],
        },
        meta: {
          timestamp: new Date().toISOString(),
          version: 'v1',
        },
      };

      res.status(200).json(response);
    } catch (err) {
      next(err);
    }
  }

  /**
   * GET /api/v1/rbac/reviewer
   * Safe information about the authenticated user and authorized reviewer role.
   */
  public async getReviewer(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      if (!req.user) {
        throw new UnauthorizedError('No authenticated user context');
      }

      const response: ApiResponse = {
        success: true,
        data: {
          user: {
            id: req.user.id,
            email: req.user.email,
            name: req.user.name,
            roles: req.user.roles,
          },
          authorizedRole: 'reviewer',
          permissions: [
            'view_assigned_candidates',
            'view_assigned_resumes',
            'view_validation_issues',
            'submit_verification_reviews',
            'add_review_comments',
          ],
        },
        meta: {
          timestamp: new Date().toISOString(),
          version: 'v1',
        },
      };

      res.status(200).json(response);
    } catch (err) {
      next(err);
    }
  }

  /**
   * POST /api/v1/rbac/roles/assign
   * Admin-only role assignment endpoint.
   */
  public async assignRole(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      if (!req.user) {
        throw new UnauthorizedError('No authenticated user context');
      }

      const { targetUserId, roleName } = req.body;
      if (!targetUserId || typeof targetUserId !== 'string') {
        throw new BadRequestError('targetUserId is required');
      }
      if (!roleName || !APP_ROLES.includes(roleName as AppRole)) {
        throw new BadRequestError(`Valid roleName required: ${APP_ROLES.join(', ')}`);
      }

      const result = await roleService.assignRole(
        req.user,
        targetUserId,
        roleName as AppRole,
        req.ip,
        req.headers['user-agent']
      );

      res.status(200).json({
        success: true,
        data: {
          targetUserId,
          assignedRole: roleName,
          previousRoles: result.previousRoles,
          updatedRoles: result.updatedRoles,
        },
        meta: {
          timestamp: new Date().toISOString(),
          version: 'v1',
        },
      });
    } catch (err) {
      next(err);
    }
  }
}

export const rbacController = new RbacController();
