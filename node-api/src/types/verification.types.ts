export type ClaimType =
  | 'education'
  | 'employment'
  | 'identity'
  | 'criminal_check'
  | 'certification'
  | 'reference';

export type ClaimStatus = 'unverified' | 'verified' | 'discrepant' | 'inconclusive';

export type VerificationStatus = 'pending' | 'passed' | 'failed' | 'requires_review';

export type VerificationPriority = 'low' | 'normal' | 'high' | 'urgent';

export interface CandidateClaimRecord {
  id: string;
  candidate_id: string;
  claim_type: ClaimType;
  organization_name: string;
  title_or_degree: string | null;
  start_date: string | null;
  end_date: string | null;
  status: ClaimStatus;
  created_at: Date;
  updated_at: Date;
}

export interface VerificationRecord {
  id: string;
  candidate_id: string;
  claim_id: string | null;
  reviewer_id: string | null;
  status: VerificationStatus;
  priority: VerificationPriority;
  notes: string | null;
  assigned_at: Date | null;
  verified_at: Date | null;
  created_at: Date;
  updated_at: Date;
}

export interface CreateClaimDTO {
  claim_type: ClaimType;
  organization_name: string;
  title_or_degree?: string | null;
  start_date?: string | null;
  end_date?: string | null;
}

export interface CreateVerificationDTO {
  candidate_id: string;
  claim_id?: string | null;
  reviewer_id?: string | null;
  priority?: VerificationPriority;
  notes?: string | null;
}

export interface ReviewVerificationDTO {
  status: 'passed' | 'failed' | 'requires_review';
  notes: string;
}

export type ReviewerDecisionType = 'APPROVED' | 'REJECTED' | 'NEEDS_INFORMATION';

export interface ReviewerDecisionDTO {
  decision: ReviewerDecisionType;
  comment?: string;
  reason?: string;
}

export interface AssignReviewerDTO {
  reviewer_id: string;
}

export interface ReviewerAssignmentDetails {
  verification: VerificationRecord;
  candidate: {
    id: string;
    full_name: string;
    email: string;
    phone: string | null;
    location: string | null;
    current_job_title: string | null;
    status: string;
  };
  resume: {
    id: string;
    file_name: string;
    file_type: string;
    file_size_bytes: number;
    document_type: string;
    uploaded_at: Date;
    download_url: string;
  } | null;
  automated_verification: {
    status: VerificationStatus;
    priority: VerificationPriority;
    total_issues: number;
  };
  validation_issues: any[];
  assignment: {
    reviewer_id: string | null;
    assigned_at: Date | null;
    status: VerificationStatus;
    priority: VerificationPriority;
  };
  review_history: Array<{
    id: string;
    action: string;
    user_id: string | null;
    created_at: Date;
    old_values?: any;
    new_values?: any;
  }>;
}
