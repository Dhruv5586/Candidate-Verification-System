import { BaseRepository } from './base.repository';
import { ValidationIssueRecord, IssueSeverity, IssueStatus } from '../types/candidate.types';

export class ValidationIssueRepository extends BaseRepository<ValidationIssueRecord> {
  protected readonly tableName = 'validation_issues';

  /**
   * Insert a validation issue record.
   */
  public async create(data: {
    candidateId?: string | null;
    documentId?: string | null;
    verificationId?: string | null;
    severity: IssueSeverity;
    issueType: string;
    description: string;
    status?: IssueStatus;
  }): Promise<ValidationIssueRecord> {
    const sql = `
      INSERT INTO validation_issues (
        candidate_id,
        document_id,
        verification_id,
        severity,
        issue_type,
        description,
        status,
        resolved,
        created_at
      ) VALUES ($1, $2, $3, $4, $5, $6, $7, false, NOW())
      RETURNING *;
    `;

    const values = [
      data.candidateId || null,
      data.documentId || null,
      data.verificationId || null,
      data.severity,
      data.issueType,
      data.description,
      data.status || 'open',
    ];

    const result = await this.executeQuery<ValidationIssueRecord>(sql, values);
    return result.rows[0];
  }

  /**
   * Find all validation issues for a candidate.
   */
  public async findByCandidateId(candidateId: string): Promise<ValidationIssueRecord[]> {
    const sql = `
      SELECT * FROM validation_issues
      WHERE candidate_id = $1
      ORDER BY created_at DESC;
    `;
    return this.findMany<ValidationIssueRecord>(sql, [candidateId]);
  }

  /**
   * Find validation issues for a specific document.
   */
  public async findByDocumentId(documentId: string): Promise<ValidationIssueRecord[]> {
    const sql = `
      SELECT * FROM validation_issues
      WHERE document_id = $1
      ORDER BY created_at DESC;
    `;
    return this.findMany<ValidationIssueRecord>(sql, [documentId]);
  }

  /**
   * Find validation issues linked to a specific verification task.
   */
  public async findByVerificationId(
    verificationId: string,
    options?: { page?: number; limit?: number }
  ): Promise<{ issues: ValidationIssueRecord[]; total: number; page: number; limit: number }> {
    const page = options?.page && options.page > 0 ? options.page : 1;
    const limit = options?.limit && options.limit > 0 && options.limit <= 100 ? options.limit : 50;
    const offset = (page - 1) * limit;

    const countSql = `SELECT COUNT(*)::int as count FROM validation_issues WHERE verification_id = $1;`;
    const countRes = await this.executeQuery<{ count: number }>(countSql, [verificationId]);
    const total = countRes.rows[0]?.count || 0;

    const sql = `
      SELECT * FROM validation_issues
      WHERE verification_id = $1
      ORDER BY created_at ASC
      LIMIT $2 OFFSET $3;
    `;
    const issues = await this.findMany<ValidationIssueRecord>(sql, [verificationId, limit, offset]);
    return { issues, total, page, limit };
  }

  /**
   * Delete existing validation issues for a verification (used for clean reruns).
   */
  public async deleteByVerificationId(verificationId: string): Promise<number> {
    const sql = `DELETE FROM validation_issues WHERE verification_id = $1;`;
    const res = await this.executeQuery(sql, [verificationId]);
    return res.rowCount ?? 0;
  }
}

export const validationIssueRepository = new ValidationIssueRepository();
