import { BaseRepository } from './base.repository';
import { AppRole, RoleRecord, UserRoleRecord } from '../types/rbac.types';
import { PoolClient } from 'pg';
import { pool } from '../config/database';

export class UserRoleRepository extends BaseRepository<RoleRecord> {
  protected readonly tableName = 'roles';

  /**
   * Fetch all assigned active role names for a specific user ID.
   */
  public async getUserRoles(userId: string, client?: PoolClient): Promise<AppRole[]> {
    const sql = `
      SELECT r.name
      FROM roles r
      INNER JOIN user_roles ur ON ur.role_id = r.id
      WHERE ur.user_id = $1
      ORDER BY r.name ASC;
    `;

    const res = client
      ? await client.query<{ name: AppRole }>(sql, [userId])
      : await this.executeQuery<{ name: AppRole }>(sql, [userId]);

    return res.rows.map((row) => row.name);
  }

  /**
   * Find a role record by name.
   */
  public async getRoleByName(roleName: AppRole, client?: PoolClient): Promise<RoleRecord | null> {
    const sql = `SELECT * FROM roles WHERE name = $1 LIMIT 1;`;
    if (client) {
      const res = await client.query<RoleRecord>(sql, [roleName]);
      return res.rows.length > 0 ? res.rows[0] : null;
    }
    return this.findOne<RoleRecord>(sql, [roleName]);
  }

  /**
   * Verify whether a user exists in the users table.
   */
  public async userExists(userId: string, client?: PoolClient): Promise<boolean> {
    const sql = `SELECT id FROM users WHERE id = $1 LIMIT 1;`;
    const res = client
      ? await client.query(sql, [userId])
      : await this.executeQuery(sql, [userId]);
    return res.rows.length > 0;
  }

  /**
   * Retrieve a user by ID to verify active status and basic info.
   */
  public async getUserById(
    userId: string,
    client?: PoolClient
  ): Promise<{ id: string; email: string; name: string; is_active: boolean } | null> {
    const sql = `SELECT id, email, name, is_active FROM users WHERE id = $1 LIMIT 1;`;
    const res = client
      ? await client.query(sql, [userId])
      : await this.executeQuery(sql, [userId]);
    return res.rows[0] || null;
  }

  /**
   * Assign a role to a user. Idempotent via ON CONFLICT.
   */
  public async assignRole(userId: string, roleName: AppRole, client?: PoolClient): Promise<void> {
    const sql = `
      INSERT INTO user_roles (user_id, role_id)
      SELECT $1, id FROM roles WHERE name = $2
      ON CONFLICT (user_id, role_id) DO NOTHING;
    `;
    if (client) {
      await client.query(sql, [userId, roleName]);
    } else {
      await this.executeQuery(sql, [userId, roleName]);
    }
  }

  /**
   * Remove a role from a user.
   */
  public async removeRole(userId: string, roleName: AppRole, client?: PoolClient): Promise<void> {
    const sql = `
      DELETE FROM user_roles
      WHERE user_id = $1
        AND role_id = (SELECT id FROM roles WHERE name = $2 LIMIT 1);
    `;
    if (client) {
      await client.query(sql, [userId, roleName]);
    } else {
      await this.executeQuery(sql, [userId, roleName]);
    }
  }

  /**
   * Ensure standard roles (admin, recruiter, reviewer) exist in the database safely.
   */
  public async ensurePredefinedRoles(): Promise<void> {
    const sql = `
      INSERT INTO roles (name, description) VALUES
        ('admin', 'Full system administration, user management, role assignments, and audit log inspection'),
        ('recruiter', 'Can import candidate records, manage candidate claims, and initiate verifications'),
        ('reviewer', 'Can inspect candidate evidence, perform background checks, and submit verification outcomes')
      ON CONFLICT (name) DO NOTHING;
    `;
    await this.executeQuery(sql);
  }
}

export const userRoleRepository = new UserRoleRepository();
