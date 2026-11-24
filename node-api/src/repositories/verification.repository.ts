import { BaseRepository } from './base.repository';
import { PoolClient } from 'pg';
import {
  VerificationRecord,
  CreateVerificationDTO,
  VerificationStatus,
  VerificationPriority,
} from '../types/verification.types';

export class VerificationRepository extends BaseRepository<VerificationRecord> {
  protected readonly tableName = 'verifications';

  public async create(data: CreateVerificationDTO): Promise<VerificationRecord> {
    const assignedAt = data.reviewer_id ? new Date() : null;
    const sql = `
      INSERT INTO verifications (
        candidate_id,
        claim_id,
        reviewer_id,
        priority,
        notes,
        status,
        assigned_at,
        created_at,
        updated_at
      )
      VALUES ($1, $2, $3, $4, $5, 'pending', $6, NOW(), NOW())
      RETURNING *;
    `;
    const values = [
      data.candidate_id,
      data.claim_id || null,
      data.reviewer_id || null,
      data.priority || 'normal',
      data.notes || null,
      assignedAt,
    ];
    const res = await this.executeQuery<VerificationRecord>(sql, values);
    return res.rows[0];
  }

  public async findById(id: string): Promise<VerificationRecord | null> {
    const sql = `SELECT * FROM verifications WHERE id = $1;`;
    const res = await this.executeQuery<VerificationRecord>(sql, [id]);
    return res.rows[0] || null;
  }

  public async findByCandidateId(candidateId: string): Promise<VerificationRecord[]> {
    const sql = `SELECT * FROM verifications WHERE candidate_id = $1 ORDER BY created_at DESC;`;
    return super.findMany(sql, [candidateId]);
  }

  public async assignReviewer(
    id: string,
    reviewerId: string,
    client?: PoolClient
  ): Promise<VerificationRecord | null> {
    const sql = `
      UPDATE verifications
      SET reviewer_id = $1,
          assigned_at = NOW(),
          updated_at = NOW()
      WHERE id = $2
      RETURNING *;
    `;
    const res = client
      ? await client.query<VerificationRecord>(sql, [reviewerId, id])
      : await this.executeQuery<VerificationRecord>(sql, [reviewerId, id]);
    return res.rows[0] || null;
  }

  public async updateReview(
    id: string,
    reviewerId: string,
    status: VerificationStatus,
    notes: string,
    client?: PoolClient
  ): Promise<VerificationRecord | null> {
    const sql = `
      UPDATE verifications
      SET status = $1,
          notes = $2,
          reviewer_id = $3,
          verified_at = NOW(),
          updated_at = NOW()
      WHERE id = $4
      RETURNING *;
    `;
    const res = client
      ? await client.query<VerificationRecord>(sql, [status, notes, reviewerId, id])
      : await this.executeQuery<VerificationRecord>(sql, [status, notes, reviewerId, id]);
    return res.rows[0] || null;
  }

  public async updateStatus(
    id: string,
    status: VerificationStatus,
    notes?: string
  ): Promise<VerificationRecord | null> {
    const sql = `
      UPDATE verifications
      SET status = $1,
          notes = COALESCE($2, notes),
          updated_at = NOW()
      WHERE id = $3
      RETURNING *;
    `;
    const res = await this.executeQuery<VerificationRecord>(sql, [status, notes || null, id]);
    return res.rows[0] || null;
  }

  public async findActiveByCandidateId(candidateId: string): Promise<VerificationRecord | null> {
    const sql = `
      SELECT * FROM verifications
      WHERE candidate_id = $1 AND status IN ('pending', 'requires_review')
      ORDER BY created_at DESC
      LIMIT 1;
    `;
    return this.findOne<VerificationRecord>(sql, [candidateId]);
  }

  public async findQueue(
    filters: {
      status?: VerificationStatus;
      priority?: VerificationPriority;
      reviewerId?: string;
      candidateId?: string;
      page?: number;
      limit?: number;
    },
    authorizedUserId?: string,
    isAdmin = false
  ): Promise<{ verifications: VerificationRecord[]; total: number; page: number; limit: number }> {
    const page = filters.page && filters.page > 0 ? filters.page : 1;
    const limit = filters.limit && filters.limit > 0 && filters.limit <= 100 ? filters.limit : 20;
    const offset = (page - 1) * limit;

    const conditions: string[] = [];
    const values: any[] = [];
    let paramIndex = 1;

    // Reviewer scoping: Reviewers can see either open/unassigned verifications or those assigned to them
    if (!isAdmin && authorizedUserId) {
      conditions.push(`(reviewer_id = $${paramIndex} OR reviewer_id IS NULL)`);
      values.push(authorizedUserId);
      paramIndex++;
    } else if (filters.reviewerId) {
      conditions.push(`reviewer_id = $${paramIndex}`);
      values.push(filters.reviewerId);
      paramIndex++;
    }

    if (filters.status) {
      conditions.push(`status = $${paramIndex}`);
      values.push(filters.status);
      paramIndex++;
    }

    if (filters.priority) {
      conditions.push(`priority = $${paramIndex}`);
      values.push(filters.priority);
      paramIndex++;
    }

    if (filters.candidateId) {
      conditions.push(`candidate_id = $${paramIndex}`);
      values.push(filters.candidateId);
      paramIndex++;
    }

    const whereClause = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : '';

    const countSql = `SELECT COUNT(*)::int as count FROM verifications ${whereClause};`;
    const countRes = await this.executeQuery<{ count: number }>(countSql, values);
    const total = countRes.rows[0]?.count || 0;

    const dataSql = `
      SELECT * FROM verifications
      ${whereClause}
      ORDER BY 
        CASE priority 
          WHEN 'urgent' THEN 1 
          WHEN 'high' THEN 2 
          WHEN 'normal' THEN 3 
          WHEN 'low' THEN 4 
          ELSE 5 
        END ASC,
        created_at ASC
      LIMIT $${paramIndex} OFFSET $${paramIndex + 1};
    `;
    values.push(limit, offset);

    const verifications = await super.findMany(dataSql, values);
    return { verifications, total, page, limit };
  }

  /**
   * Find only verifications strictly assigned to a specific reviewer.
   * Reviewers cannot see other reviewers' assignments or unassigned tasks here.
   */
  public async findReviewerAssignments(
    reviewerId: string,
    filters: {
      status?: VerificationStatus;
      page?: number;
      limit?: number;
    },
    isAdmin = false
  ): Promise<{ verifications: VerificationRecord[]; total: number; page: number; limit: number }> {
    const page = filters.page && filters.page > 0 ? filters.page : 1;
    const limit = filters.limit && filters.limit > 0 && filters.limit <= 100 ? filters.limit : 20;
    const offset = (page - 1) * limit;

    const conditions: string[] = [];
    const values: any[] = [];
    let paramIndex = 1;

    if (!isAdmin) {
      conditions.push(`v.reviewer_id = $${paramIndex}`);
      values.push(reviewerId);
      paramIndex++;
    } else {
      conditions.push(`(v.reviewer_id = $${paramIndex} OR v.reviewer_id IS NOT NULL)`);
      values.push(reviewerId);
      paramIndex++;
    }

    if (filters.status) {
      conditions.push(`v.status = $${paramIndex}`);
      values.push(filters.status);
      paramIndex++;
    }

    const whereClause = `WHERE ${conditions.join(' AND ')}`;

    const countSql = `SELECT COUNT(*)::int as count FROM verifications v ${whereClause};`;
    const countRes = await this.executeQuery<{ count: number }>(countSql, values);
    const total = countRes.rows[0]?.count || 0;

    const dataSql = `
      SELECT v.*, c.full_name AS candidate_name, c.email AS candidate_email
      FROM verifications v
      LEFT JOIN candidates c ON v.candidate_id = c.id
      ${whereClause}
      ORDER BY 
        CASE v.priority 
          WHEN 'urgent' THEN 1 
          WHEN 'high' THEN 2 
          WHEN 'normal' THEN 3 
          WHEN 'low' THEN 4 
          ELSE 5 
        END ASC,
        v.created_at ASC
      LIMIT $${paramIndex} OFFSET $${paramIndex + 1};
    `;
    values.push(limit, offset);

    const verifications = await super.findMany(dataSql, values);
    return { verifications, total, page, limit };
  }
}

export const verificationRepository = new VerificationRepository();
