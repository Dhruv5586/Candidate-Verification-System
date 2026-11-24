import { BaseRepository } from './base.repository';
import { DocumentRecord } from '../types/candidate.types';

export class DocumentRepository extends BaseRepository<DocumentRecord> {
  protected readonly tableName = 'documents';

  /**
   * Insert a document record.
   */
  public async create(data: {
    candidateId: string;
    claimId?: string | null;
    fileName: string;
    fileType: string;
    fileSizeBytes: number;
    storageKey: string;
    checksumSha256: string;
    documentType?: string;
    uploadStatus?: string;
    uploadedBy?: string | null;
  }): Promise<DocumentRecord> {
    const sql = `
      INSERT INTO documents (
        candidate_id,
        claim_id,
        file_name,
        file_type,
        file_size_bytes,
        storage_key,
        checksum_sha256,
        document_type,
        upload_status,
        uploaded_by,
        created_at,
        updated_at
      ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, NOW(), NOW())
      RETURNING *;
    `;

    const values = [
      data.candidateId,
      data.claimId || null,
      data.fileName,
      data.fileType,
      data.fileSizeBytes,
      data.storageKey,
      data.checksumSha256,
      data.documentType || 'resume',
      data.uploadStatus || 'completed',
      data.uploadedBy || null,
    ];

    const result = await this.executeQuery<DocumentRecord>(sql, values);
    return result.rows[0];
  }

  /**
   * Find document by ID.
   */
  public async findById(id: string): Promise<DocumentRecord | null> {
    const sql = `SELECT * FROM documents WHERE id = $1 LIMIT 1;`;
    return this.findOne<DocumentRecord>(sql, [id]);
  }

  /**
   * Find all documents for a specific candidate.
   */
  public async findByCandidateId(candidateId: string): Promise<DocumentRecord[]> {
    const sql = `SELECT * FROM documents WHERE candidate_id = $1 ORDER BY created_at DESC;`;
    return this.findMany<DocumentRecord>(sql, [candidateId]);
  }

  /**
   * Find document by candidate and SHA-256 checksum to detect duplicate resume uploads.
   */
  public async findByChecksum(candidateId: string, checksum: string): Promise<DocumentRecord | null> {
    const sql = `
      SELECT * FROM documents
      WHERE candidate_id = $1 AND checksum_sha256 = $2
      LIMIT 1;
    `;
    return this.findOne<DocumentRecord>(sql, [candidateId, checksum]);
  }
}

export const documentRepository = new DocumentRepository();
