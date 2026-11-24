import { AuthenticatedUser } from '../types/auth.types';

export interface CandidateResourceScope {
  candidateId: string;
  recruiterId?: string | null;
  batchId?: string | null;
}

export interface VerificationResourceScope {
  verificationId: string;
  candidateId: string;
  assignedReviewerId?: string | null;
}

/**
 * Resource-level authorization service preparing ownership and assignment
 * boundaries for future candidate management and verification workflows.
 */
export class ResourceAuthorizationService {
  /**
   * Determine if an authenticated user can access a specific candidate record.
   * - Admin: Can access all candidate records globally.
   * - Recruiter: Can access candidate records belonging to their assigned batch or ownership.
   * - Reviewer: Can access candidate records only if assigned to inspect them.
   */
  public async canAccessCandidate(
    user: AuthenticatedUser,
    scope: CandidateResourceScope
  ): Promise<boolean> {
    if (!user || !user.roles) {
      return false;
    }

    // 1. Admin has global visibility across all candidates
    if (user.roles.includes('admin')) {
      return true;
    }

    // 2. Recruiter can access candidates within their authorized ownership scope
    if (user.roles.includes('recruiter')) {
      if (scope.recruiterId && scope.recruiterId === user.id) {
        return true;
      }
      // If no specific owner is assigned, allow recruiters scoped to active batches
      if (!scope.recruiterId && scope.batchId) {
        return true;
      }
      // Unassigned candidates in general recruiter queue
      if (!scope.recruiterId && !scope.batchId) {
        return true;
      }
    }

    // 3. Reviewer can only access candidates assigned to them for verification
    if (user.roles.includes('reviewer')) {
      // Reviewers do not have general candidate ownership access
      return false;
    }

    return false;
  }

  /**
   * Determine if an authenticated user can perform or submit a verification review.
   * - Admin: Can inspect and override all verification records.
   * - Reviewer: Can review only verifications specifically assigned to them.
   * - Recruiter: Forbidden from performing verification reviews (separation of duties).
   */
  public async canReviewVerification(
    user: AuthenticatedUser,
    scope: VerificationResourceScope
  ): Promise<boolean> {
    if (!user || !user.roles) {
      return false;
    }

    // 1. Admin has global verification oversight
    if (user.roles.includes('admin')) {
      return true;
    }

    // 2. Reviewer must be assigned to the verification
    if (user.roles.includes('reviewer')) {
      if (scope.assignedReviewerId && scope.assignedReviewerId === user.id) {
        return true;
      }
      // General unassigned review queue
      if (!scope.assignedReviewerId) {
        return true;
      }
      return false;
    }

    // 3. Recruiters can never review verifications
    if (user.roles.includes('recruiter')) {
      return false;
    }

    return false;
  }
}

export const resourceAuthService = new ResourceAuthorizationService();
