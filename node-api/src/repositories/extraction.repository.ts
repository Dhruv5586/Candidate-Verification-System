import { BaseRepository } from './base.repository';
import { ResumeExtractionRecord } from '../types/candidate.types';

export class ExtractionRepository extends BaseRepository<ResumeExtractionRecord> {
  protected readonly tableName = 'resume_extractions';

  /**
   * Insert extracted text and document structure metadata.
   */
  public async create(data: {
    documentId: string;
    extractedText: string;
    extractedData?: Record<string, any> | null;
    extractionStatus?: string;
    parserName: string;
    parserVersion: string;
  }): Promise<ResumeExtractionRecord> {
    const sql = `
      INSERT INTO resume_extractions (
        document_id,
        extracted_text,
        extracted_data,
        extraction_status,
        parser_name,
        parser_version,
        created_at
      ) VALUES ($1, $2, $3, $4, $5, $6, NOW())
      RETURNING *;
    `;

    const values = [
      data.documentId,
      data.extractedText,
      data.extractedData ? JSON.stringify(data.extractedData) : null,
      data.extractionStatus || 'completed',
      data.parserName,
      data.parserVersion,
    ];

    const result = await this.executeQuery<ResumeExtractionRecord>(sql, values);
    return result.rows[0];
  }

  /**
   * Find extraction result by document ID.
   */
  public async findByDocumentId(documentId: string): Promise<ResumeExtractionRecord | null> {
    const sql = `SELECT * FROM resume_extractions WHERE document_id = $1 LIMIT 1;`;
    return this.findOne<ResumeExtractionRecord>(sql, [documentId]);
  }
}

export const extractionRepository = new ExtractionRepository();
