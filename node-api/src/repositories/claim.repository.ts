import { BaseRepository } from './base.repository';
import { PoolClient } from 'pg';
import { CandidateClaimRecord, CreateClaimDTO, ClaimStatus } from '../types/verification.types';

export class ClaimRepository extends BaseRepository<CandidateClaimRecord> {
  protected readonly tableName = 'candidate_claims';

  public async create(candidateId: string, data: CreateClaimDTO): Promise<CandidateClaimRecord> {
    const sql = `
      INSERT INTO candidate_claims (
        candidate_id,
        claim_type,
        organization_name,
        title_or_degree,
        start_date,
        end_date,
        status,
        created_at,
        updated_at
      )
      VALUES ($1, $2, $3, $4, $5, $6, 'unverified', NOW(), NOW())
      RETURNING *;
    `;
    const values = [
      candidateId,
      data.claim_type,
      data.organization_name,
      data.title_or_degree || null,
      data.start_date || null,
      data.end_date || null,
    ];
    const res = await this.executeQuery<CandidateClaimRecord>(sql, values);
    return res.rows[0];
  }

  public async findByCandidateId(candidateId: string): Promise<CandidateClaimRecord[]> {
    const sql = `SELECT * FROM candidate_claims WHERE candidate_id = $1 ORDER BY created_at ASC;`;
    return super.findMany(sql, [candidateId]);
  }

  public async findById(id: string): Promise<CandidateClaimRecord | null> {
    const sql = `SELECT * FROM candidate_claims WHERE id = $1;`;
    const res = await this.executeQuery<CandidateClaimRecord>(sql, [id]);
    return res.rows[0] || null;
  }

  public async updateStatus(
    id: string,
    status: ClaimStatus,
    client?: PoolClient
  ): Promise<CandidateClaimRecord | null> {
    const sql = `
      UPDATE candidate_claims
      SET status = $1,
          updated_at = NOW()
      WHERE id = $2
      RETURNING *;
    `;
    const res = client
      ? await client.query<CandidateClaimRecord>(sql, [status, id])
      : await this.executeQuery<CandidateClaimRecord>(sql, [status, id]);
    return res.rows[0] || null;
  }
}

export const claimRepository = new ClaimRepository();
