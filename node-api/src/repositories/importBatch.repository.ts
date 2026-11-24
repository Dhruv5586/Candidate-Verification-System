import { BaseRepository } from './base.repository';
import { ImportBatchRecord, BatchStatus } from '../types/import.types';

export class ImportBatchRepository extends BaseRepository<ImportBatchRecord> {
  protected readonly tableName = 'import_batches';

  public async create(data: {
    uploadedBy: string | null;
    fileName: string;
    storageKey: string;
    checksumSha256: string;
    fileSizeBytes: number;
    totalRows: number;
  }): Promise<ImportBatchRecord> {
    const sql = `
      INSERT INTO import_batches (
        uploaded_by,
        file_name,
        storage_key,
        checksum_sha256,
        file_size_bytes,
        total_rows,
        status,
        created_at
      )
      VALUES ($1, $2, $3, $4, $5, $6, 'pending', NOW())
      RETURNING *;
    `;
    const values = [
      data.uploadedBy,
      data.fileName,
      data.storageKey,
      data.checksumSha256,
      data.fileSizeBytes,
      data.totalRows,
    ];
    const res = await this.executeQuery<ImportBatchRecord>(sql, values);
    return res.rows[0];
  }

  public async findById(id: string): Promise<ImportBatchRecord | null> {
    const sql = `SELECT * FROM import_batches WHERE id = $1;`;
    const res = await this.executeQuery<ImportBatchRecord>(sql, [id]);
    return res.rows[0] || null;
  }

  public async updateProgress(
    id: string,
    processed: number,
    successful: number,
    failed: number,
    errorSummary?: any
  ): Promise<void> {
    const sql = `
      UPDATE import_batches
      SET processed_rows = $1,
          successful_rows = $2,
          failed_rows = $3,
          error_summary = COALESCE($4, error_summary)
      WHERE id = $5;
    `;
    await this.executeQuery(sql, [
      processed,
      successful,
      failed,
      errorSummary ? JSON.stringify(errorSummary) : null,
      id,
    ]);
  }

  public async updateStatus(id: string, status: BatchStatus, completed = false): Promise<void> {
    const sql = `
      UPDATE import_batches
      SET status = $1,
          completed_at = CASE WHEN $2 THEN NOW() ELSE completed_at END
      WHERE id = $3;
    `;
    await this.executeQuery(sql, [status, completed, id]);
  }

  public async claimForProcessing(id: string): Promise<boolean> {
    const sql = `
      UPDATE import_batches
      SET status = 'processing'
      WHERE id = $1 AND status = 'pending'
      RETURNING id;
    `;
    const res = await this.executeQuery(sql, [id]);
    return (res.rowCount ?? 0) > 0;
  }

  public async findPaginated(
    filters: { status?: BatchStatus; page?: number; limit?: number },
    authorizedUserId?: string,
    isAdmin = false
  ): Promise<{ batches: ImportBatchRecord[]; total: number; page: number; limit: number }> {
    const page = filters.page && filters.page > 0 ? filters.page : 1;
    const limit = filters.limit && filters.limit > 0 && filters.limit <= 100 ? filters.limit : 20;
    const offset = (page - 1) * limit;

    const conditions: string[] = [];
    const values: any[] = [];
    let paramIndex = 1;

    // Recruiter scoping: non-admins can only see their own uploaded batches
    if (!isAdmin && authorizedUserId) {
      conditions.push(`uploaded_by = $${paramIndex}`);
      values.push(authorizedUserId);
      paramIndex++;
    }

    if (filters.status) {
      conditions.push(`status = $${paramIndex}`);
      values.push(filters.status);
      paramIndex++;
    }

    const whereClause = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : '';

    const countSql = `SELECT COUNT(*)::int as count FROM import_batches ${whereClause};`;
    const countRes = await this.executeQuery<{ count: number }>(countSql, values);
    const total = countRes.rows[0]?.count || 0;

    const dataSql = `
      SELECT * FROM import_batches
      ${whereClause}
      ORDER BY created_at DESC
      LIMIT $${paramIndex} OFFSET $${paramIndex + 1};
    `;
    values.push(limit, offset);

    const batches = await super.findMany(dataSql, values);
    return { batches, total, page, limit };
  }
}

export const importBatchRepository = new ImportBatchRepository();
