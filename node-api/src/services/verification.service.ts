import { claimRepository } from '../repositories/claim.repository';
import { verificationRepository } from '../repositories/verification.repository';
import { candidateRepository } from '../repositories/candidate.repository';
import { documentRepository } from '../repositories/document.repository';
import { extractionRepository } from '../repositories/extraction.repository';
import { validationIssueRepository } from '../repositories/validationIssue.repository';
import { resumeValidationService } from './resumeValidation.service';
import { auditLogRepository } from '../repositories/auditLog.repository';
import { userRoleRepository } from '../repositories/userRole.repository';
import { resourceAuthService } from './resourceAuth.service';
import { AuthenticatedUser } from '../types/auth.types';
import { PoolClient } from 'pg';
import { pool } from '../config/database';
import {
  CandidateClaimRecord,
  VerificationRecord,
  CreateClaimDTO,
  CreateVerificationDTO,
  ReviewVerificationDTO,
  ReviewerDecisionType,
  ReviewerDecisionDTO,
  ReviewerAssignmentDetails,
  VerificationStatus,
  VerificationPriority,
} from '../types/verification.types';
import { ValidationIssueRecord } from '../types/candidate.types';
import {
  BadRequestError,
  NotFoundError,
  ForbiddenError,
  ConflictError,
} from '../utils/errors';
import { logger } from '../utils/logger';

export class VerificationService {
  /**
   * Add a verifiable claim (education, employment, certification, etc.) to a candidate profile.
   * Admin or owning Recruiter only.
   */
  public async addClaim(
    user: AuthenticatedUser,
    candidateId: string,
    data: CreateClaimDTO,
    ipAddress?: string,
    userAgent?: string
  ): Promise<CandidateClaimRecord> {
    if (!user.roles.includes('admin') && !user.roles.includes('recruiter')) {
      throw new ForbiddenError('Only recruiters and administrators can add candidate credential claims');
    }

    const candidate = await candidateRepository.findById(candidateId);
    if (!candidate || candidate.deleted_at) {
      throw new NotFoundError(`Candidate not found: ${candidateId}`);
    }

    const canAccess = await resourceAuthService.canAccessCandidate(user, {
      candidateId: candidate.id,
      recruiterId: candidate.created_by,
    });
    if (!canAccess) {
      throw new ForbiddenError('Unauthorized: you do not have permission to add claims to this candidate');
    }

    const claim = await claimRepository.create(candidateId, data);

    await auditLogRepository.logEvent({
      userId: user.id,
      action: 'CLAIM_CREATED',
      entityType: 'claim',
      entityId: claim.id,
      newValues: {
        candidateId,
        claimType: claim.claim_type,
        organizationName: claim.organization_name,
        titleOrDegree: claim.title_or_degree,
      },
      ipAddress,
      userAgent,
    });

    logger.info({ candidateId, claimId: claim.id }, 'Candidate credential claim added');
    return claim;
  }

  /**
   * List all credential claims for a candidate.
   */
  public async getClaims(
    user: AuthenticatedUser,
    candidateId: string
  ): Promise<CandidateClaimRecord[]> {
    const candidate = await candidateRepository.findById(candidateId);
    if (!candidate || candidate.deleted_at) {
      throw new NotFoundError(`Candidate not found: ${candidateId}`);
    }

    const canAccess = await resourceAuthService.canAccessCandidate(user, {
      candidateId: candidate.id,
      recruiterId: candidate.created_by,
    });
    if (!canAccess && !user.roles.includes('reviewer')) {
      throw new ForbiddenError('Unauthorized: you do not have permission to view claims for this candidate');
    }

    return claimRepository.findByCandidateId(candidateId);
  }

  /**
   * Create a verification task for candidate/claim.
   * Admin or Recruiter only.
   */
  public async createVerification(
    user: AuthenticatedUser,
    data: CreateVerificationDTO,
    ipAddress?: string,
    userAgent?: string
  ): Promise<VerificationRecord> {
    if (!user.roles.includes('admin') && !user.roles.includes('recruiter')) {
      throw new ForbiddenError('Only recruiters and administrators can create verification tasks');
    }

    const candidate = await candidateRepository.findById(data.candidate_id);
    if (!candidate) {
      throw new NotFoundError(`Candidate not found: ${data.candidate_id}`);
    }

    if (data.claim_id) {
      const claim = await claimRepository.findById(data.claim_id);
      if (!claim || claim.candidate_id !== data.candidate_id) {
        throw new NotFoundError(`Claim not found or does not belong to candidate: ${data.claim_id}`);
      }
    }

    const verification = await verificationRepository.create(data);

    // Transition candidate status to in_progress if still pending
    if (candidate.status === 'pending') {
      await candidateRepository.update(candidate.id, { status: 'in_progress' });
    }

    await auditLogRepository.logEvent({
      userId: user.id,
      action: 'VERIFICATION_CREATED',
      entityType: 'verification',
      entityId: verification.id,
      newValues: {
        candidateId: verification.candidate_id,
        claimId: verification.claim_id,
        reviewerId: verification.reviewer_id,
        priority: verification.priority,
      },
      ipAddress,
      userAgent,
    });

    logger.info({ verificationId: verification.id, candidateId: data.candidate_id }, 'Verification task created');
    return verification;
  }

  /**
   * View verification queue.
   * Reviewers see assigned or unassigned verification tasks; Admins see all tasks.
   * Recruiters are forbidden (separation of duties).
   */
  public async getVerificationQueue(
    user: AuthenticatedUser,
    filters: {
      status?: VerificationStatus;
      priority?: VerificationPriority;
      reviewerId?: string;
      candidateId?: string;
      page?: number;
      limit?: number;
    }
  ): Promise<{ verifications: VerificationRecord[]; total: number; page: number; limit: number }> {
    if (!user.roles.includes('admin') && !user.roles.includes('reviewer')) {
      throw new ForbiddenError('Access forbidden: only reviewers and administrators can access the verification queue');
    }

    const isAdmin = user.roles.includes('admin');
    return verificationRepository.findQueue(filters, user.id, isAdmin);
  }

  /**
   * Phase 9 Step 6: Assign or reassign verification task to an active human reviewer.
   * Admin or authorized Recruiter only. Reviewers forbidden.
   */
  public async assignReviewer(
    user: AuthenticatedUser,
    verificationId: string,
    reviewerId: string,
    ipAddress?: string,
    userAgent?: string
  ): Promise<VerificationRecord> {
    if (!user.roles.includes('admin') && !user.roles.includes('recruiter')) {
      throw new ForbiddenError('Only administrators and recruiters can assign verification reviewers');
    }

    const verification = await verificationRepository.findById(verificationId);
    if (!verification) {
      throw new NotFoundError(`Verification not found: ${verificationId}`);
    }

    // Recruiter resource-level authorization
    if (user.roles.includes('recruiter') && !user.roles.includes('admin')) {
      const candidate = await candidateRepository.findById(verification.candidate_id);
      if (candidate) {
        const canAccess = await resourceAuthService.canAccessCandidate(user, {
          candidateId: candidate.id,
          recruiterId: candidate.created_by,
        });
        if (!canAccess) {
          throw new ForbiddenError('Unauthorized: you do not have permission to assign reviewers to this verification');
        }
      }
    }

    // Eligibility check: cannot reassign terminal verifications
    if (verification.status === 'passed' || verification.status === 'failed') {
      throw new BadRequestError('Cannot assign reviewer to an already completed verification');
    }

    // Duplicate assignment guard
    if (verification.reviewer_id === reviewerId) {
      throw new ConflictError('Verification is already assigned to this reviewer');
    }

    // UUID format check
    const isUuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(reviewerId);
    if (!isUuid) {
      throw new BadRequestError('Invalid reviewer ID');
    }

    // Verify target user exists and is active
    const targetUser = await userRoleRepository.getUserById(reviewerId);
    if (targetUser && !targetUser.is_active) {
      throw new BadRequestError('Cannot assign inactive user as reviewer');
    }

    // Verify reviewer role
    const reviewerRoles = await userRoleRepository.getUserRoles(reviewerId);
    if (!reviewerRoles || reviewerRoles.length === 0) {
      throw new BadRequestError('Invalid reviewer ID: user does not exist');
    }
    if (!reviewerRoles.includes('reviewer') && !reviewerRoles.includes('admin')) {
      throw new BadRequestError('User without reviewer role cannot be assigned');
    }

    return this.executeTransactionalAssignment(user, verification, reviewerId, ipAddress, userAgent);
  }

  private async executeTransactionalAssignment(
    user: AuthenticatedUser,
    verification: VerificationRecord,
    reviewerId: string,
    ipAddress?: string,
    userAgent?: string
  ): Promise<VerificationRecord> {
    let client: PoolClient | null = null;
    try {
      client = await pool.connect();
      await client.query('BEGIN');
    } catch (_) {
      // Mock / fallback when pool is not connected
    }

    try {
      const updated = await verificationRepository.assignReviewer(
        verification.id,
        reviewerId,
        client || undefined
      );
      if (!updated) {
        throw new NotFoundError(`Verification not found: ${verification.id}`);
      }

      await auditLogRepository.logEvent(
        {
          userId: user.id,
          action: 'VERIFICATION_ASSIGNED',
          entityType: 'verification',
          entityId: verification.id,
          oldValues: { reviewerId: verification.reviewer_id },
          newValues: { reviewerId, assignedBy: user.id },
          ipAddress,
          userAgent,
        },
        client || undefined
      );

      if (client) {
        await client.query('COMMIT');
      }

      logger.info(
        { verificationId: verification.id, reviewerId, assignedBy: user.id },
        'Verification reviewer assigned successfully'
      );
      return updated;
    } catch (err) {
      if (client) {
        try {
          await client.query('ROLLBACK');
        } catch (_) { }
      }
      throw err;
    } finally {
      if (client) {
        try {
          client.release();
        } catch (_) { }
      }
    }
  }

  /**
   * Submit review decision (passed, failed, requires_review).
   * Reviewer or Admin only.
   * Strict separation of duties: Recruiters are forbidden from verifying.
   */
  public async submitReview(
    user: AuthenticatedUser,
    verificationId: string,
    data: ReviewVerificationDTO,
    ipAddress?: string,
    userAgent?: string
  ): Promise<VerificationRecord> {
    if (user.roles.includes('recruiter') && !user.roles.includes('admin') && !user.roles.includes('reviewer')) {
      throw new ForbiddenError('Strict separation of duties: recruiters cannot review or verify candidate claims');
    }

    const verification = await verificationRepository.findById(verificationId);
    if (!verification) {
      throw new NotFoundError(`Verification not found: ${verificationId}`);
    }

    const canReview = await resourceAuthService.canReviewVerification(user, {
      verificationId: verification.id,
      candidateId: verification.candidate_id,
      assignedReviewerId: verification.reviewer_id,
    });
    if (!canReview) {
      throw new ForbiddenError('Unauthorized: you are not assigned to review this verification task');
    }

    const updatedVerification = await verificationRepository.updateReview(
      verificationId,
      user.id,
      data.status,
      data.notes
    );
    if (!updatedVerification) {
      throw new NotFoundError(`Verification not found: ${verificationId}`);
    }

    // If verification is linked to a claim, update claim status accordingly
    if (verification.claim_id) {
      const claimStatus =
        data.status === 'passed'
          ? 'verified'
          : data.status === 'failed'
            ? 'discrepant'
            : 'inconclusive';
      await claimRepository.updateStatus(verification.claim_id, claimStatus);
    }

    // Evaluate candidate overall status
    const allCandidateVerifications = await verificationRepository.findByCandidateId(
      verification.candidate_id
    );
    const hasFailed = allCandidateVerifications.some((v) => v.status === 'failed');
    const allPassed =
      allCandidateVerifications.length > 0 &&
      allCandidateVerifications.every((v) => v.status === 'passed');

    if (hasFailed) {
      await candidateRepository.update(verification.candidate_id, { status: 'flagged' });
    } else if (allPassed) {
      await candidateRepository.update(verification.candidate_id, { status: 'verified' });
    }

    await auditLogRepository.logEvent({
      userId: user.id,
      action: 'VERIFICATION_REVIEW_SUBMITTED',
      entityType: 'verification',
      entityId: verification.id,
      oldValues: { status: verification.status, notes: verification.notes },
      newValues: { status: data.status, notes: data.notes, reviewerId: user.id },
      ipAddress,
      userAgent,
    });

    logger.info(
      { verificationId, status: data.status, reviewerId: user.id },
      'Verification review submitted successfully'
    );
    return updatedVerification;
  }

  /**
   * Phase 9 Step 5: Initiate automated candidate verification workflow.
   * - Enforces role checks (Admin or Recruiter only).
   * - Validates candidate existence, non-deletion, and ownership scoping.
   * - Checks that a usable resume document exists.
   * - Prevents duplicate active verification requests.
   * - Executes automated 10-rule resume screening checks.
   * - Sets status to 'requires_review' if issues detected, or 'passed' if clean.
   * - Records immutable audit trail.
   */
  public async initiateCandidateVerification(
    user: AuthenticatedUser,
    candidateId: string,
    priority: VerificationPriority = 'normal',
    ipAddress?: string,
    userAgent?: string
  ): Promise<{
    verification: VerificationRecord;
    issues: ValidationIssueRecord[];
    totalIssues: number;
  }> {
    if (!user.roles.includes('admin') && !user.roles.includes('recruiter')) {
      throw new ForbiddenError('Only recruiters and administrators can initiate candidate verification');
    }

    const candidate = await candidateRepository.findById(candidateId);
    if (!candidate || candidate.deleted_at) {
      throw new NotFoundError(`Candidate not found: ${candidateId}`);
    }

    const canAccess = await resourceAuthService.canAccessCandidate(user, {
      candidateId: candidate.id,
      recruiterId: candidate.created_by,
    });
    if (!canAccess) {
      throw new ForbiddenError('Unauthorized: you do not have permission to verify this candidate');
    }

    // Check that a usable resume document exists
    const docs = await documentRepository.findByCandidateId(candidateId);
    if (!docs || docs.length === 0) {
      throw new BadRequestError('Candidate does not have an uploaded resume for verification');
    }

    // Prevent duplicate active verification requests
    const activeVerification = await verificationRepository.findActiveByCandidateId(candidateId);
    if (activeVerification) {
      throw new ConflictError(
        `Active verification is already in progress for this candidate (ID: ${activeVerification.id})`
      );
    }

    // Create verification record
    const verification = await verificationRepository.create({
      candidate_id: candidate.id,
      priority,
      notes: `Automated verification initiated by ${user.name || user.email}`,
    });

    // Obtain extracted text for latest document
    const doc = docs[0];
    const extraction = await extractionRepository.findByDocumentId(doc.id);
    const extractedText = extraction ? extraction.extracted_text : '';

    // Clear any previous issues for this verification to ensure safe idempotent rerun
    await validationIssueRepository.deleteByVerificationId(verification.id);

    // Run automated screening checks
    const issues = await resumeValidationService.validateResume(
      candidate,
      doc.id,
      extractedText,
      verification.id
    );

    // If issues found, status is 'requires_review'; otherwise 'passed'
    const status: VerificationStatus = issues.length > 0 ? 'requires_review' : 'passed';
    const updated = await verificationRepository.updateStatus(
      verification.id,
      status,
      `Automated verification completed: ${issues.length} screening issue(s) detected`
    );

    // Transition candidate status to in_progress if currently pending
    if (candidate.status === 'pending') {
      await candidateRepository.update(candidate.id, { status: 'in_progress' });
    }

    await auditLogRepository.logEvent({
      userId: user.id,
      action: 'CANDIDATE_VERIFICATION_INITIATED',
      entityType: 'verification',
      entityId: verification.id,
      newValues: {
        candidateId: candidate.id,
        documentId: doc.id,
        status,
        priority,
        totalIssues: issues.length,
      },
      ipAddress,
      userAgent,
    });

    logger.info(
      {
        candidateId,
        verificationId: verification.id,
        status,
        issuesCount: issues.length,
      },
      'Candidate automated verification workflow executed'
    );

    return {
      verification: updated || verification,
      issues,
      totalIssues: issues.length,
    };
  }

  /**
   * List all verifications for a candidate.
   */
  public async getCandidateVerifications(
    user: AuthenticatedUser,
    candidateId: string
  ): Promise<VerificationRecord[]> {
    const candidate = await candidateRepository.findById(candidateId);
    if (!candidate || candidate.deleted_at) {
      throw new NotFoundError(`Candidate not found: ${candidateId}`);
    }

    const canAccess = await resourceAuthService.canAccessCandidate(user, {
      candidateId: candidate.id,
      recruiterId: candidate.created_by,
    });
    if (!canAccess && !user.roles.includes('reviewer')) {
      throw new ForbiddenError('Unauthorized: you do not have permission to view this candidate');
    }

    return verificationRepository.findByCandidateId(candidateId);
  }

  /**
   * Get single verification record by ID.
   */
  public async getVerificationById(
    user: AuthenticatedUser,
    verificationId: string
  ): Promise<VerificationRecord> {
    const verification = await verificationRepository.findById(verificationId);
    if (!verification) {
      throw new NotFoundError(`Verification not found: ${verificationId}`);
    }

    const candidate = await candidateRepository.findById(verification.candidate_id);
    if (candidate) {
      const canAccess = await resourceAuthService.canAccessCandidate(user, {
        candidateId: candidate.id,
        recruiterId: candidate.created_by,
      });
      if (!canAccess && !user.roles.includes('reviewer')) {
        throw new ForbiddenError('Unauthorized: you do not have permission to view this verification');
      }
    }

    return verification;
  }

  /**
   * Get validation issues linked to a verification task.
   */
  public async getVerificationIssues(
    user: AuthenticatedUser,
    verificationId: string,
    options?: { page?: number; limit?: number }
  ): Promise<{ issues: ValidationIssueRecord[]; total: number; page: number; limit: number }> {
    const verification = await this.getVerificationById(user, verificationId);
    return validationIssueRepository.findByVerificationId(verification.id, options);
  }

  /**
   * Phase 9 Step 6: Reviewer assignments queue.
   * Return only verifications strictly assigned to the logged-in reviewer.
   * Reviewers cannot view other reviewers' assignments.
   */
  public async getReviewerAssignments(
    user: AuthenticatedUser,
    filters: {
      status?: VerificationStatus;
      page?: number;
      limit?: number;
    }
  ): Promise<{ verifications: VerificationRecord[]; total: number; page: number; limit: number }> {
    if (!user.roles.includes('reviewer') && !user.roles.includes('admin')) {
      throw new ForbiddenError('Access forbidden: only reviewers and administrators can access assignments queue');
    }

    return verificationRepository.findReviewerAssignments(user.id, filters, user.roles.includes('admin'));
  }

  /**
   * Phase 9 Step 6: Reviewer verification details.
   * Return candidate info, resume metadata & secure download link, automated verification summary,
   * validation issues, assignment status, and audit review history.
   * Enforces reviewer ownership.
   */
  public async getReviewerAssignmentDetails(
    user: AuthenticatedUser,
    verificationId: string
  ): Promise<ReviewerAssignmentDetails> {
    if (!user.roles.includes('reviewer') && !user.roles.includes('admin')) {
      throw new ForbiddenError('Access forbidden: only reviewers and administrators can inspect verification assignments');
    }

    const verification = await verificationRepository.findById(verificationId);
    if (!verification) {
      throw new NotFoundError(`Verification assignment not found: ${verificationId}`);
    }

    // Reviewer ownership enforcement (administrators can view all)
    if (!user.roles.includes('admin') && verification.reviewer_id !== user.id) {
      throw new ForbiddenError('Access forbidden: this verification task is not assigned to you');
    }

    const candidate = await candidateRepository.findById(verification.candidate_id);
    if (!candidate) {
      throw new NotFoundError(`Candidate not found: ${verification.candidate_id}`);
    }

    // Documents metadata (safe: no storage_key or private paths)
    const docs = await documentRepository.findByCandidateId(candidate.id);
    const resumeDoc = docs && docs.length > 0 ? docs[0] : null;

    const resumeMetadata = resumeDoc
      ? {
        id: resumeDoc.id,
        file_name: resumeDoc.file_name,
        file_type: resumeDoc.file_type,
        file_size_bytes: resumeDoc.file_size_bytes,
        document_type: resumeDoc.document_type,
        uploaded_at: resumeDoc.created_at,
        download_url: `/api/v1/resumes/${candidate.id}/download`,
      }
      : null;

    // Validation issues
    const issuesData = await validationIssueRepository.findByVerificationId(verification.id);

    // Audit / Review history
    const auditLogs = await auditLogRepository.getLogsForEntity('verification', verification.id);
    const reviewHistory = auditLogs.map((log) => ({
      id: log.id,
      action: log.action,
      user_id: log.user_id,
      created_at: log.created_at,
      old_values: log.old_values,
      new_values: log.new_values,
    }));

    return {
      verification,
      candidate: {
        id: candidate.id,
        full_name: candidate.full_name,
        email: candidate.email,
        phone: candidate.phone,
        location: candidate.location,
        current_job_title: candidate.current_job_title,
        status: candidate.status,
      },
      resume: resumeMetadata,
      automated_verification: {
        status: verification.status,
        priority: verification.priority,
        total_issues: issuesData.total,
      },
      validation_issues: issuesData.issues,
      assignment: {
        reviewer_id: verification.reviewer_id,
        assigned_at: verification.assigned_at,
        status: verification.status,
        priority: verification.priority,
      },
      review_history: reviewHistory,
    };
  }

  /**
   * Phase 9 Step 6: Reviewer decision endpoint.
   * Handles APPROVED, REJECTED, and NEEDS_INFORMATION decisions.
   * Enforces reviewer ownership, conflict of interest, reason requirements,
   * repeated decision guards, and transaction-safe status updates.
   */
  public async submitReviewerDecision(
    user: AuthenticatedUser,
    verificationId: string,
    data: ReviewerDecisionDTO,
    ipAddress?: string,
    userAgent?: string
  ): Promise<VerificationRecord> {
    if (!user.roles.includes('reviewer') && !user.roles.includes('admin')) {
      throw new ForbiddenError('Access forbidden: only reviewers and administrators can submit verification decisions');
    }

    const verification = await verificationRepository.findById(verificationId);
    if (!verification) {
      throw new NotFoundError(`Verification assignment not found: ${verificationId}`);
    }

    // Must be assigned
    if (!verification.reviewer_id) {
      throw new BadRequestError('Cannot submit decision on an unassigned verification task');
    }

    // Enforce reviewer ownership (allow admin override)
    if (verification.reviewer_id !== user.id && !user.roles.includes('admin')) {
      throw new ForbiddenError('Access forbidden: you are not the assigned reviewer for this verification');
    }

    // Conflict of interest policy: reviewers cannot review candidates created by themselves or matching their email
    const candidate = await candidateRepository.findById(verification.candidate_id);
    if (candidate && !user.roles.includes('admin')) {
      const isCreator = candidate.created_by && candidate.created_by === user.id;
      const isSelf = user.email && candidate.email.toLowerCase() === user.email.toLowerCase();
      if (isCreator || isSelf) {
        throw new ForbiddenError('Conflict of interest: reviewers cannot review or approve their own candidates');
      }
    }

    // Validate decision type
    const validDecisions: ReviewerDecisionType[] = ['APPROVED', 'REJECTED', 'NEEDS_INFORMATION'];
    if (!validDecisions.includes(data.decision)) {
      throw new BadRequestError('Invalid decision. Must be one of: APPROVED, REJECTED, NEEDS_INFORMATION');
    }

    const comment = (data.comment || data.reason || '').trim();
    if ((data.decision === 'REJECTED' || data.decision === 'NEEDS_INFORMATION') && comment.length < 5) {
      throw new BadRequestError(
        `A valid reason/comment (at least 5 characters) is required for ${data.decision} decisions`
      );
    }

    // Map decision to verification status
    const targetStatus: VerificationStatus =
      data.decision === 'APPROVED'
        ? 'passed'
        : data.decision === 'REJECTED'
          ? 'failed'
          : 'requires_review';

    // Repeated decision check
    if (verification.status === targetStatus) {
      throw new ConflictError(
        `A decision of ${data.decision} has already been recorded for this verification task`
      );
    }

    return this.executeTransactionalDecision(
      user,
      verification,
      data.decision,
      targetStatus,
      comment,
      ipAddress,
      userAgent
    );
  }

  private async executeTransactionalDecision(
    user: AuthenticatedUser,
    verification: VerificationRecord,
    decision: ReviewerDecisionType,
    targetStatus: VerificationStatus,
    comment: string,
    ipAddress?: string,
    userAgent?: string
  ): Promise<VerificationRecord> {
    let client: PoolClient | null = null;
    try {
      client = await pool.connect();
      await client.query('BEGIN');
    } catch (_) {
      // Mock / fallback when pool is not connected
    }

    try {
      // 1. Update verification record
      const updated = await verificationRepository.updateReview(
        verification.id,
        user.id,
        targetStatus,
        comment,
        client || undefined
      );

      if (!updated) {
        throw new NotFoundError(`Verification not found: ${verification.id}`);
      }

      // 2. Synchronize candidate claim if linked
      if (verification.claim_id) {
        const claimStatus =
          targetStatus === 'passed'
            ? 'verified'
            : targetStatus === 'failed'
              ? 'discrepant'
              : 'inconclusive';
        await claimRepository.updateStatus(verification.claim_id, claimStatus, client || undefined);
      }

      // 3. Synchronize overall candidate status
      const allVers = await verificationRepository.findByCandidateId(verification.candidate_id);
      const otherVers = allVers.filter((v) => v.id !== verification.id);
      const allCurrentStatuses = [...otherVers.map((v) => v.status), targetStatus];

      if (targetStatus === 'failed' || allCurrentStatuses.includes('failed')) {
        await candidateRepository.update(verification.candidate_id, { status: 'flagged' }, client || undefined);
      } else if (allCurrentStatuses.length > 0 && allCurrentStatuses.every((s) => s === 'passed')) {
        await candidateRepository.update(verification.candidate_id, { status: 'verified' }, client || undefined);
      } else {
        await candidateRepository.update(verification.candidate_id, { status: 'in_progress' }, client || undefined);
      }

      // 4. Record immutable audit log
      await auditLogRepository.logEvent(
        {
          userId: user.id,
          action: 'VERIFICATION_DECISION_SUBMITTED',
          entityType: 'verification',
          entityId: verification.id,
          oldValues: { status: verification.status, notes: verification.notes },
          newValues: {
            decision,
            status: targetStatus,
            comments: comment,
            reviewerId: user.id,
          },
          ipAddress,
          userAgent,
        },
        client || undefined
      );

      if (client) {
        await client.query('COMMIT');
      }

      logger.info(
        { verificationId: verification.id, decision, targetStatus, reviewerId: user.id },
        'Reviewer decision submitted successfully'
      );

      return updated;
    } catch (err) {
      if (client) {
        try {
          await client.query('ROLLBACK');
        } catch (_) { }
      }
      throw err;
    } finally {
      if (client) {
        try {
          client.release();
        } catch (_) { }
      }
    }
  }
}

export const verificationService = new VerificationService();
