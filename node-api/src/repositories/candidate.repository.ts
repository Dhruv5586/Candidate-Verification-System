import { BaseRepository } from './base.repository';
import { PoolClient } from 'pg';
import {
  CandidateRecord,
  CreateCandidateDTO,
  UpdateCandidateDTO,
  CandidateQueryFilter,
} from '../types/candidate.types';

export class CandidateRepository extends BaseRepository<CandidateRecord> {
  protected readonly tableName = 'candidates';

  /**
   * Insert a new candidate record.
   */
  public async create(
    data: CreateCandidateDTO,
    createdBy?: string,
    importBatchId?: string
  ): Promise<CandidateRecord> {
    const names = data.full_name.trim().split(/\s+/);
    const firstName = names[0] || '';
    const lastName = names.slice(1).join(' ') || '';

    const sql = `
      INSERT INTO candidates (
        first_name,
        last_name,
        full_name,
        email,
        phone,
        location,
        current_job_title,
        status,
        created_by,
        import_batch_id
      ) VALUES ($1, $2, $3, $4, $5, $6, $7, 'pending', $8, $9)
      RETURNING *;
    `;

    const values = [
      firstName,
      lastName,
      data.full_name.trim(),
      data.email.trim().toLowerCase(),
      data.phone?.trim() || null,
      data.location?.trim() || null,
      data.current_job_title?.trim() || null,
      createdBy || null,
      importBatchId || null,
    ];

    const result = await this.executeQuery<CandidateRecord>(sql, values);
    return result.rows[0];
  }

  /**
   * Find candidate by ID (excluding soft-deleted candidates by default).
   */
  public async findById(id: string, includeDeleted = false): Promise<CandidateRecord | null> {
    const sql = `
      SELECT * FROM candidates
      WHERE id = $1 ${includeDeleted ? '' : 'AND deleted_at IS NULL'}
      LIMIT 1;
    `;
    return this.findOne<CandidateRecord>(sql, [id]);
  }

  /**
   * Find candidate by email (case-insensitive, non-deleted).
   */
  public async findByEmail(email: string): Promise<CandidateRecord | null> {
    const sql = `
      SELECT * FROM candidates
      WHERE LOWER(email) = LOWER($1) AND deleted_at IS NULL
      LIMIT 1;
    `;
    return this.findOne<CandidateRecord>(sql, [email.trim().toLowerCase()]);
  }

  /**
   * Find existing candidates matching an array of emails (case-insensitive, non-deleted).
   * Executes a single batched query using ANY($1::text[]) for high performance.
   * Returns a Map of lowercase email to candidate summary { id, email, status }.
   */
  public async findExistingEmails(
    emails: string[]
  ): Promise<Map<string, { id: string; email: string; status: string }>> {
    const map = new Map<string, { id: string; email: string; status: string }>();
    if (!emails || emails.length === 0) return map;

    const normalized = Array.from(
      new Set(
        emails
          .map((e) => (typeof e === 'string' ? e.trim().toLowerCase() : ''))
          .filter((e) => e.length > 0)
      )
    );

    if (normalized.length === 0) return map;

    // Chunk in batches of 1000 to maintain safe query parameter bounds
    const chunkSize = 1000;
    for (let i = 0; i < normalized.length; i += chunkSize) {
      const chunk = normalized.slice(i, i + chunkSize);
      const sql = `
        SELECT id, email, status
        FROM candidates
        WHERE LOWER(email) = ANY($1::text[]) AND deleted_at IS NULL;
      `;
      const res = await this.executeQuery<{ id: string; email: string; status: string }>(sql, [chunk]);
      for (const row of res.rows) {
        map.set(row.email.trim().toLowerCase(), {
          id: row.id,
          email: row.email,
          status: row.status,
        });
      }
    }

    return map;
  }

  /**
   * Search and list candidates with pagination and scope enforcement.
   */
  public async findPaginated(
    filters: CandidateQueryFilter,
    authorizedUserId?: string,
    isAdmin = false
  ): Promise<{ candidates: CandidateRecord[]; total: number; page: number; limit: number }> {
    const page = filters.page && filters.page > 0 ? filters.page : 1;
    const limit = filters.limit && filters.limit > 0 && filters.limit <= 100 ? filters.limit : 20;
    const offset = (page - 1) * limit;

    const conditions: string[] = ['deleted_at IS NULL'];
    const values: any[] = [];
    let paramIndex = 1;

    // Recruiter scoping: non-admins can view candidates they created (or unassigned in general pool)
    if (!isAdmin && authorizedUserId) {
      conditions.push(`(created_by = $${paramIndex} OR created_by IS NULL)`);
      values.push(authorizedUserId);
      paramIndex++;
    }

    if (filters.status) {
      conditions.push(`status = $${paramIndex}`);
      values.push(filters.status);
      paramIndex++;
    }

    if (filters.batch_id) {
      conditions.push(`import_batch_id = $${paramIndex}`);
      values.push(filters.batch_id);
      paramIndex++;
    }

    if (filters.search) {
      conditions.push(`(
        LOWER(full_name) LIKE $${paramIndex} OR
        LOWER(email) LIKE $${paramIndex} OR
        LOWER(COALESCE(location, '')) LIKE $${paramIndex}
      )`);
      values.push(`%${filters.search.toLowerCase()}%`);
      paramIndex++;
    }

    const whereClause = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : '';

    const countSql = `SELECT COUNT(*)::int as count FROM candidates ${whereClause};`;
    const countRes = await this.executeQuery<{ count: number }>(countSql, values);
    const total = countRes.rows[0]?.count || 0;

    const dataSql = `
      SELECT * FROM candidates
      ${whereClause}
      ORDER BY created_at DESC
      LIMIT $${paramIndex} OFFSET $${paramIndex + 1};
    `;
    values.push(limit, offset);

    const candidates = await super.findMany(dataSql, values);

    return { candidates, total, page, limit };
  }

  /**
   * Update candidate details.
   */
  public async update(
    id: string,
    updates: UpdateCandidateDTO,
    client?: PoolClient
  ): Promise<CandidateRecord | null> {
    const fields: string[] = ['updated_at = NOW()'];
    const values: any[] = [id];
    let paramIndex = 2;

    if (updates.full_name !== undefined) {
      const names = updates.full_name.trim().split(/\s+/);
      fields.push(`full_name = $${paramIndex}`);
      values.push(updates.full_name.trim());
      paramIndex++;

      fields.push(`first_name = $${paramIndex}`);
      values.push(names[0] || '');
      paramIndex++;

      fields.push(`last_name = $${paramIndex}`);
      values.push(names.slice(1).join(' ') || '');
      paramIndex++;
    }

    if (updates.email !== undefined) {
      fields.push(`email = $${paramIndex}`);
      values.push(updates.email.trim().toLowerCase());
      paramIndex++;
    }

    if (updates.phone !== undefined) {
      fields.push(`phone = $${paramIndex}`);
      values.push(updates.phone ? updates.phone.trim() : null);
      paramIndex++;
    }

    if (updates.location !== undefined) {
      fields.push(`location = $${paramIndex}`);
      values.push(updates.location ? updates.location.trim() : null);
      paramIndex++;
    }

    if (updates.current_job_title !== undefined) {
      fields.push(`current_job_title = $${paramIndex}`);
      values.push(updates.current_job_title ? updates.current_job_title.trim() : null);
      paramIndex++;
    }

    if (updates.status !== undefined) {
      fields.push(`status = $${paramIndex}`);
      values.push(updates.status);
      paramIndex++;
    }

    const sql = `
      UPDATE candidates
      SET ${fields.join(', ')}
      WHERE id = $1 AND deleted_at IS NULL
      RETURNING *;
    `;

    const res = client
      ? await client.query<CandidateRecord>(sql, values)
      : await this.executeQuery<CandidateRecord>(sql, values);
    return res.rows.length > 0 ? res.rows[0] : null;
  }

  /**
   * Soft delete candidate.
   */
  public async softDelete(id: string): Promise<boolean> {
    const sql = `
      UPDATE candidates
      SET deleted_at = NOW(), updated_at = NOW()
      WHERE id = $1 AND deleted_at IS NULL;
    `;
    const res = await this.executeQuery(sql, [id]);
    return (res.rowCount ?? 0) > 0;
  }

  /**
   * Return live system counts for dashboard telemetry.
   */
  public async getDashboardStats(): Promise<{
    totalCandidates: number;
    pendingCandidates: number;
    verifiedCandidates: number;
    flaggedCandidates: number;
    resumesParsed: number;
    pendingVerifications: number;
    activeVerificationTasks: number;
    reviewerPool: number;
  }> {
    const candidateSql = `
      SELECT 
        COUNT(*)::int as total,
        COUNT(CASE WHEN status = 'pending' THEN 1 END)::int as pending,
        COUNT(CASE WHEN status = 'verified' THEN 1 END)::int as verified,
        COUNT(CASE WHEN status = 'flagged' THEN 1 END)::int as flagged
      FROM candidates
      WHERE deleted_at IS NULL;
    `;
    const docsSql = `SELECT COUNT(*)::int as count FROM documents;`;
    const verifSql = `
      SELECT 
        COUNT(*)::int as total,
        COUNT(CASE WHEN status IN ('pending', 'requires_review') THEN 1 END)::int as pending
      FROM verifications;
    `;
    const reviewerSql = `
      SELECT COUNT(DISTINCT ur.user_id)::int as count 
      FROM user_roles ur 
      JOIN roles r ON r.id = ur.role_id 
      WHERE r.name = 'reviewer';
    `;

    const [candRes, docsRes, verifRes, reviewerRes] = await Promise.all([
      this.executeQuery<any>(candidateSql),
      this.executeQuery<any>(docsSql),
      this.executeQuery<any>(verifSql),
      this.executeQuery<any>(reviewerSql),
    ]);

    const candRow = candRes.rows[0] || { total: 0, pending: 0, verified: 0, flagged: 0 };
    const docsCount = docsRes.rows[0]?.count || 0;
    const verifRow = verifRes.rows[0] || { total: 0, pending: 0 };
    const reviewerCount = reviewerRes.rows[0]?.count || 1;

    return {
      totalCandidates: candRow.total,
      pendingCandidates: candRow.pending,
      verifiedCandidates: candRow.verified,
      flaggedCandidates: candRow.flagged,
      resumesParsed: docsCount,
      pendingVerifications: candRow.pending,
      activeVerificationTasks: verifRow.pending,
      reviewerPool: reviewerCount,
    };
  }
}

export const candidateRepository = new CandidateRepository();
