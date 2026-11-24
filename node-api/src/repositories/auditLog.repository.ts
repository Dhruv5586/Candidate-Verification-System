import { BaseRepository } from './base.repository';
import { AuditLogRecord } from '../types/rbac.types';
import { pool } from '../config/database';
import { PoolClient } from 'pg';

export class AuditLogRepository extends BaseRepository<AuditLogRecord> {
  protected readonly tableName = 'audit_logs';

  /**
   * Insert an immutable audit log entry.
   * Never stores credentials, raw tokens, or secrets.
   */
  public async logEvent(
    params: {
      userId?: string | null;
      action: string;
      entityType: string;
      entityId?: string | null;
      oldValues?: Record<string, any> | null;
      newValues?: Record<string, any> | null;
      ipAddress?: string | null;
      userAgent?: string | null;
    },
    client?: PoolClient
  ): Promise<void> {
    const sql = `
      INSERT INTO audit_logs (
        user_id,
        action,
        entity_type,
        entity_id,
        old_values,
        new_values,
        ip_address,
        user_agent
      ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8);
    `;

    const values = [
      params.userId || null,
      params.action,
      params.entityType,
      params.entityId || null,
      params.oldValues ? JSON.stringify(params.oldValues) : null,
      params.newValues ? JSON.stringify(params.newValues) : null,
      params.ipAddress || null,
      params.userAgent || null,
    ];

    if (client) {
      await client.query(sql, values);
    } else {
      await this.executeQuery(sql, values);
    }
  }

  /**
   * Retrieve recent audit logs for a target entity or actor.
   */
  public async getLogsForEntity(entityType: string, entityId: string): Promise<AuditLogRecord[]> {
    const sql = `
      SELECT * FROM audit_logs
      WHERE entity_type = $1 AND entity_id = $2
      ORDER BY created_at DESC
      LIMIT 100;
    `;
    return this.findMany(sql, [entityType, entityId]);
  }
}

export const auditLogRepository = new AuditLogRepository();
