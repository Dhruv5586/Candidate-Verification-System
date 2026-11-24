import { pool } from '../config/database';
import { userRoleRepository } from '../repositories/userRole.repository';
import { auditLogRepository } from '../repositories/auditLog.repository';
import { AppRole, APP_ROLES } from '../types/rbac.types';
import { AuthenticatedUser } from '../types/auth.types';
import {
  ForbiddenError,
  BadRequestError,
  NotFoundError,
  ServiceUnavailableError,
} from '../utils/errors';
import { logger } from '../utils/logger';

export class RoleService {
  /**
   * Assign a role to a target user.
   * Only administrators can assign roles.
   * Users cannot assign roles to themselves.
   * Executes within a database transaction with audit logging.
   */
  public async assignRole(
    actorUser: AuthenticatedUser,
    targetUserId: string,
    roleName: AppRole,
    ipAddress?: string,
    userAgent?: string
  ): Promise<{ previousRoles: AppRole[]; updatedRoles: AppRole[] }> {
    // 1. Enforce authorization: only admin can manage roles
    if (!actorUser.roles.includes('admin')) {
      throw new ForbiddenError('Unauthorized: only administrators can assign user roles');
    }

    // 2. Prevent self-assignment of roles
    if (actorUser.id === targetUserId) {
      throw new ForbiddenError('Self-assignment of roles is strictly prohibited');
    }

    // 3. Validate role name
    if (!APP_ROLES.includes(roleName)) {
      throw new BadRequestError(`Invalid role specified: ${roleName}. Allowed: ${APP_ROLES.join(', ')}`);
    }

    const client = await pool.connect();
    try {
      await client.query('BEGIN');

      // 4. Verify target user exists
      const userExists = await userRoleRepository.userExists(targetUserId, client);
      if (!userExists) {
        throw new NotFoundError(`Target user not found: ${targetUserId}`);
      }

      // 5. Fetch previous roles
      const previousRoles = await userRoleRepository.getUserRoles(targetUserId, client);

      // 6. Assign role
      await userRoleRepository.assignRole(targetUserId, roleName, client);

      // 7. Fetch updated roles
      const updatedRoles = await userRoleRepository.getUserRoles(targetUserId, client);

      // 8. Record audit log entry
      await auditLogRepository.logEvent(
        {
          userId: actorUser.id,
          action: 'ROLE_ASSIGNED',
          entityType: 'user_role',
          entityId: targetUserId,
          oldValues: { roles: previousRoles },
          newValues: { roles: updatedRoles, addedRole: roleName },
          ipAddress,
          userAgent,
        },
        client
      );

      await client.query('COMMIT');
      logger.info(
        { actorId: actorUser.id, targetUserId, roleName },
        'Role successfully assigned to user'
      );

      return { previousRoles, updatedRoles };
    } catch (err) {
      await client.query('ROLLBACK');
      throw err;
    } finally {
      client.release();
    }
  }

  /**
   * Remove a role from a target user.
   * Only administrators can remove roles.
   * Users cannot modify their own roles.
   */
  public async removeRole(
    actorUser: AuthenticatedUser,
    targetUserId: string,
    roleName: AppRole,
    ipAddress?: string,
    userAgent?: string
  ): Promise<{ previousRoles: AppRole[]; updatedRoles: AppRole[] }> {
    if (!actorUser.roles.includes('admin')) {
      throw new ForbiddenError('Unauthorized: only administrators can modify user roles');
    }

    if (actorUser.id === targetUserId) {
      throw new ForbiddenError('Self-removal of roles is strictly prohibited');
    }

    const client = await pool.connect();
    try {
      await client.query('BEGIN');

      const userExists = await userRoleRepository.userExists(targetUserId, client);
      if (!userExists) {
        throw new NotFoundError(`Target user not found: ${targetUserId}`);
      }

      const previousRoles = await userRoleRepository.getUserRoles(targetUserId, client);
      await userRoleRepository.removeRole(targetUserId, roleName, client);
      const updatedRoles = await userRoleRepository.getUserRoles(targetUserId, client);

      await auditLogRepository.logEvent(
        {
          userId: actorUser.id,
          action: 'ROLE_REMOVED',
          entityType: 'user_role',
          entityId: targetUserId,
          oldValues: { roles: previousRoles },
          newValues: { roles: updatedRoles, removedRole: roleName },
          ipAddress,
          userAgent,
        },
        client
      );

      await client.query('COMMIT');
      return { previousRoles, updatedRoles };
    } catch (err) {
      await client.query('ROLLBACK');
      throw err;
    } finally {
      client.release();
    }
  }

  /**
   * Fetch all roles assigned to a user from PostgreSQL.
   */
  public async getUserRoles(userId: string): Promise<AppRole[]> {
    return userRoleRepository.getUserRoles(userId);
  }
}

export const roleService = new RoleService();
