import { candidateRepository } from '../repositories/candidate.repository';
import { auditLogRepository } from '../repositories/auditLog.repository';
import { resourceAuthService } from './resourceAuth.service';
import {
  CandidateRecord,
  CreateCandidateDTO,
  UpdateCandidateDTO,
  CandidateQueryFilter,
} from '../types/candidate.types';
import { AuthenticatedUser } from '../types/auth.types';
import {
  ConflictError,
  NotFoundError,
  ForbiddenError,
  BadRequestError,
} from '../utils/errors';
import { logger } from '../utils/logger';

export class CandidateService {
  /**
   * Create a new candidate record.
   * Recruiter & Admin authorized.
   * Rejects duplicate candidates with the same email.
   */
  public async createCandidate(
    user: AuthenticatedUser,
    data: CreateCandidateDTO,
    ipAddress?: string,
    userAgent?: string
  ): Promise<CandidateRecord> {
    if (!user.roles.includes('admin') && !user.roles.includes('recruiter')) {
      throw new ForbiddenError('Only recruiters and administrators can create candidate records');
    }

    const normalizedEmail = data.email.trim().toLowerCase();

    // Check for duplicate candidate by email
    const existing = await candidateRepository.findByEmail(normalizedEmail);
    if (existing) {
      throw new ConflictError(`Candidate with email '${normalizedEmail}' already exists`);
    }

    const candidate = await candidateRepository.create(
      { ...data, email: normalizedEmail },
      user.id
    );

    await auditLogRepository.logEvent({
      userId: user.id,
      action: 'CANDIDATE_CREATED',
      entityType: 'candidate',
      entityId: candidate.id,
      newValues: {
        id: candidate.id,
        full_name: candidate.full_name,
        email: candidate.email,
        created_by: user.id,
      },
      ipAddress,
      userAgent,
    });

    logger.info({ candidateId: candidate.id, userId: user.id }, 'Candidate created successfully');
    return candidate;
  }

  /**
   * Get candidate by ID with resource-level authorization.
   */
  public async getCandidateById(
    user: AuthenticatedUser,
    candidateId: string
  ): Promise<CandidateRecord> {
    const candidate = await candidateRepository.findById(candidateId);
    if (!candidate) {
      throw new NotFoundError(`Candidate not found: ${candidateId}`);
    }

    const canAccess = await resourceAuthService.canAccessCandidate(user, {
      candidateId: candidate.id,
      recruiterId: candidate.created_by,
    });

    if (!canAccess && !user.roles.includes('reviewer')) {
      throw new ForbiddenError('Unauthorized: you do not have permission to view this candidate');
    }

    return candidate;
  }

  /**
   * List candidates with pagination and scope enforcement.
   */
  public async listCandidates(
    user: AuthenticatedUser,
    filters: CandidateQueryFilter
  ): Promise<{ candidates: CandidateRecord[]; total: number; page: number; limit: number }> {
    const isAdmin = user.roles.includes('admin');
    return candidateRepository.findPaginated(filters, user.id, isAdmin);
  }

  /**
   * Update candidate details.
   * Reviewers strictly prohibited. Recruiters can update only their authorized candidates.
   */
  public async updateCandidate(
    user: AuthenticatedUser,
    candidateId: string,
    updates: UpdateCandidateDTO,
    ipAddress?: string,
    userAgent?: string
  ): Promise<CandidateRecord> {
    if (user.roles.includes('reviewer') && !user.roles.includes('admin') && !user.roles.includes('recruiter')) {
      throw new ForbiddenError('Reviewers have read-only access and cannot modify candidates');
    }

    const candidate = await candidateRepository.findById(candidateId);
    if (!candidate) {
      throw new NotFoundError(`Candidate not found: ${candidateId}`);
    }

    const canAccess = await resourceAuthService.canAccessCandidate(user, {
      candidateId: candidate.id,
      recruiterId: candidate.created_by,
    });

    if (!canAccess) {
      throw new ForbiddenError('Unauthorized: you do not have permission to modify this candidate');
    }

    // If email is changing, check duplicate conflict
    if (updates.email && updates.email.trim().toLowerCase() !== candidate.email.toLowerCase()) {
      const emailConflict = await candidateRepository.findByEmail(updates.email.trim().toLowerCase());
      if (emailConflict && emailConflict.id !== candidateId) {
        throw new ConflictError(`Another candidate already exists with email '${updates.email}'`);
      }
    }

    const updated = await candidateRepository.update(candidateId, updates);
    if (!updated) {
      throw new NotFoundError(`Candidate not found: ${candidateId}`);
    }

    await auditLogRepository.logEvent({
      userId: user.id,
      action: 'CANDIDATE_UPDATED',
      entityType: 'candidate',
      entityId: candidate.id,
      oldValues: {
        full_name: candidate.full_name,
        email: candidate.email,
        phone: candidate.phone,
        status: candidate.status,
      },
      newValues: {
        full_name: updated.full_name,
        email: updated.email,
        phone: updated.phone,
        status: updated.status,
      },
      ipAddress,
      userAgent,
    });

    return updated;
  }

  /**
   * Soft-delete candidate.
   * Admin and owning recruiter only.
   */
  public async deleteCandidate(
    user: AuthenticatedUser,
    candidateId: string,
    ipAddress?: string,
    userAgent?: string
  ): Promise<void> {
    if (user.roles.includes('reviewer') && !user.roles.includes('admin') && !user.roles.includes('recruiter')) {
      throw new ForbiddenError('Reviewers cannot delete candidate records');
    }

    const candidate = await candidateRepository.findById(candidateId);
    if (!candidate) {
      throw new NotFoundError(`Candidate not found: ${candidateId}`);
    }

    const canAccess = await resourceAuthService.canAccessCandidate(user, {
      candidateId: candidate.id,
      recruiterId: candidate.created_by,
    });

    if (!canAccess) {
      throw new ForbiddenError('Unauthorized: you do not have permission to delete this candidate');
    }

    const success = await candidateRepository.softDelete(candidateId);
    if (!success) {
      throw new NotFoundError(`Candidate not found: ${candidateId}`);
    }

    await auditLogRepository.logEvent({
      userId: user.id,
      action: 'CANDIDATE_DELETED',
      entityType: 'candidate',
      entityId: candidate.id,
      oldValues: {
        full_name: candidate.full_name,
        email: candidate.email,
        deleted_at: null,
      },
      newValues: {
        deleted_at: new Date().toISOString(),
      },
      ipAddress,
      userAgent,
    });

    logger.info({ candidateId, userId: user.id }, 'Candidate soft-deleted successfully');
  }

  /**
   * Return live telemetry statistics for dashboard KPI cards.
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
    return candidateRepository.getDashboardStats();
  }
}

export const candidateService = new CandidateService();
