export type CandidateStatus = 'pending' | 'in_progress' | 'verified' | 'flagged' | 'rejected';

export interface CandidateRecord {
  id: string;
  first_name?: string | null;
  last_name?: string | null;
  full_name: string;
  email: string;
  phone: string | null;
  location: string | null;
  current_job_title: string | null;
  status: CandidateStatus;
  created_by: string | null;
  import_batch_id?: string | null;
  created_at: Date;
  updated_at: Date;
  deleted_at: Date | null;
}

export interface CreateCandidateDTO {
  full_name: string;
  email: string;
  phone?: string | null;
  location?: string | null;
  current_job_title?: string | null;
  import_batch_id?: string | null;
}

export interface UpdateCandidateDTO {
  full_name?: string;
  email?: string;
  phone?: string | null;
  location?: string | null;
  current_job_title?: string | null;
  status?: CandidateStatus;
}

export interface CandidateQueryFilter {
  search?: string;
  status?: CandidateStatus;
  batch_id?: string;
  page?: number;
  limit?: number;
}

export interface DocumentRecord {
  id: string;
  candidate_id: string;
  claim_id: string | null;
  file_name: string;
  file_type: string;
  file_size_bytes: number;
  storage_key: string;
  checksum_sha256: string;
  document_type: string;
  upload_status: string;
  uploaded_by: string | null;
  created_at: Date;
  updated_at: Date;
}

export interface ResumeExtractionRecord {
  id: string;
  document_id: string;
  extracted_text: string;
  extracted_data: Record<string, any> | null;
  extraction_status: 'pending' | 'processing' | 'completed' | 'failed' | 'unreadable';
  parser_name: string;
  parser_version: string;
  created_at: Date;
}

export type IssueSeverity = 'low' | 'medium' | 'high' | 'critical';
export type IssueStatus = 'open' | 'resolved' | 'dismissed';

export interface ValidationIssueRecord {
  id: string;
  verification_id: string | null;
  candidate_id: string | null;
  document_id: string | null;
  severity: IssueSeverity;
  issue_type: string;
  description: string;
  status: IssueStatus;
  resolved: boolean;
  resolved_by: string | null;
  resolved_at: Date | null;
  created_at: Date;
}
