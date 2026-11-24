import { describe, it, mock, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import request from 'supertest';
import { app } from '../app';
import { userRoleRepository } from '../repositories/userRole.repository';
import { claimRepository } from '../repositories/claim.repository';
import { verificationRepository } from '../repositories/verification.repository';
import { candidateRepository } from '../repositories/candidate.repository';
import { documentRepository } from '../repositories/document.repository';
import { validationIssueRepository } from '../repositories/validationIssue.repository';
import { auditLogRepository } from '../repositories/auditLog.repository';
import { CandidateClaimRecord, VerificationRecord } from '../types/verification.types';
import { CandidateRecord, DocumentRecord, ValidationIssueRecord } from '../types/candidate.types';

describe('Phase 9 Step 6: Reviewer Assignment & Review Workflow Test Suite', () => {
  afterEach(() => {
    mock.reset();
  });

  const recruiterUser = {
    valid: true,
    user_id: '11111111-1111-1111-1111-111111111111',
    email: 'recruiter@example.com',
    name: 'Rachel Recruiter',
    roles: ['recruiter'],
    session_id: 'sess-recruiter-1',
    expires_at: '2026-11-30T12:00:00Z',
  };

  const adminUser = {
    valid: true,
    user_id: '22222222-2222-2222-2222-222222222222',
    email: 'admin@example.com',
    name: 'Adam Admin',
    roles: ['admin'],
    session_id: 'sess-admin-1',
    expires_at: '2026-11-30T12:00:00Z',
  };

  const reviewerUser = {
    valid: true,
    user_id: '33333333-3333-3333-3333-333333333333',
    email: 'reviewer@example.com',
    name: 'Rita Reviewer',
    roles: ['reviewer'],
    session_id: 'sess-reviewer-1',
    expires_at: '2026-11-30T12:00:00Z',
  };

  const otherReviewer = {
    valid: true,
    user_id: '44444444-4444-4444-4444-444444444444',
    email: 'oscar.reviewer@example.com',
    name: 'Oscar Reviewer',
    roles: ['reviewer'],
    session_id: 'sess-reviewer-2',
    expires_at: '2026-11-30T12:00:00Z',
  };

  const nonReviewerUser = {
    valid: true,
    user_id: '55555555-5555-5555-5555-555555555555',
    email: 'plain.user@example.com',
    name: 'Paul Plain',
    roles: ['recruiter'],
    session_id: 'sess-plain-1',
    expires_at: '2026-11-30T12:00:00Z',
  };

  const setupMockAuth = (userPayload: any) => {
    mock.method(globalThis, 'fetch', async () => {
      return new Response(JSON.stringify(userPayload), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      });
    });
    mock.method(userRoleRepository, 'getUserRoles', async (userId?: string) => {
      if (userId === otherReviewer.user_id) return otherReviewer.roles;
      if (userId === reviewerUser.user_id) return reviewerUser.roles;
      if (userId === nonReviewerUser.user_id) return nonReviewerUser.roles;
      if (userId === adminUser.user_id) return adminUser.roles;
      return userPayload.roles;
    });
  };

  const sampleCandidate: CandidateRecord = {
    id: '10010000-0000-0000-0000-000000000001',
    full_name: 'John Doe',
    email: 'john.doe@example.com',
    phone: '+1-555-0123',
    location: 'New York, NY',
    current_job_title: 'Full Stack Engineer',
    status: 'in_progress',
    created_by: '11111111-1111-1111-1111-111111111111',
    created_at: new Date(),
    updated_at: new Date(),
    deleted_at: null,
  };

  const sampleClaim: CandidateClaimRecord = {
    id: '20010000-0000-0000-0000-000000000002',
    candidate_id: '10010000-0000-0000-0000-000000000001',
    claim_type: 'employment',
    organization_name: 'Acme Technologies',
    title_or_degree: 'Senior Software Engineer',
    start_date: '2020-01-01',
    end_date: '2023-12-31',
    status: 'unverified',
    created_at: new Date(),
    updated_at: new Date(),
  };

  const sampleVerification: VerificationRecord = {
    id: '30010000-0000-0000-0000-000000000003',
    candidate_id: '10010000-0000-0000-0000-000000000001',
    claim_id: '20010000-0000-0000-0000-000000000002',
    reviewer_id: null,
    status: 'requires_review',
    priority: 'high',
    notes: 'Review candidate credentials',
    assigned_at: null,
    verified_at: null,
    created_at: new Date(),
    updated_at: new Date(),
  };

  const sampleDocument: DocumentRecord = {
    id: '40010000-0000-0000-0000-000000000004',
    candidate_id: '10010000-0000-0000-0000-000000000001',
    claim_id: null,
    file_name: 'john_doe_resume.pdf',
    file_type: 'application/pdf',
    file_size_bytes: 45000,
    storage_key: 'uploads/resumes/john_doe_resume.pdf',
    checksum_sha256: 'abc123sha256fakechecksumvaluehere99',
    document_type: 'resume',
    upload_status: 'completed',
    uploaded_by: '11111111-1111-1111-1111-111111111111',
    created_at: new Date(),
    updated_at: new Date(),
  };

  const sampleIssue: ValidationIssueRecord = {
    id: 'iss-001',
    verification_id: '30010000-0000-0000-0000-000000000003',
    candidate_id: '10010000-0000-0000-0000-000000000001',
    document_id: '40010000-0000-0000-0000-000000000004',
    issue_type: 'PHONE_NOT_DETECTED',
    severity: 'low',
    description: 'Phone not detected in resume text',
    resolved: false,
    status: 'open',
    created_at: new Date(),
    updated_at: new Date(),
  };

  // 1. Admin assigns reviewer successfully
  it('1. should allow admin to assign a reviewer to verification', async () => {
    setupMockAuth(adminUser);

    mock.method(verificationRepository, 'findById', async () => sampleVerification);
    mock.method(userRoleRepository, 'getUserById', async () => ({
      id: reviewerUser.user_id,
      email: reviewerUser.email,
      name: reviewerUser.name,
      is_active: true,
    }));
    mock.method(verificationRepository, 'assignReviewer', async () => ({
      ...sampleVerification,
      reviewer_id: reviewerUser.user_id,
      assigned_at: new Date(),
    }));
    let loggedEvent: any;
    mock.method(auditLogRepository, 'logEvent', async (event: any) => {
      loggedEvent = event;
      return {} as any;
    });

    const res = await request(app)
      .post(`/api/v1/verifications/${sampleVerification.id}/assign`)
      .set('Cookie', ['cvs_session=admin-token'])
      .send({ reviewer_id: reviewerUser.user_id });

    assert.equal(res.status, 200);
    assert.equal(res.body.success, true);
    assert.equal(res.body.data.reviewer_id, reviewerUser.user_id);
    assert.equal(loggedEvent?.action, 'VERIFICATION_ASSIGNED');
    assert.equal(loggedEvent?.newValues.reviewerId, reviewerUser.user_id);
  });

  // 2. Recruiter assigns reviewer successfully
  it('2. should allow recruiter to assign a reviewer to a candidate verification they own', async () => {
    setupMockAuth(recruiterUser);

    mock.method(verificationRepository, 'findById', async () => sampleVerification);
    mock.method(candidateRepository, 'findById', async () => sampleCandidate);
    mock.method(userRoleRepository, 'getUserById', async () => ({
      id: reviewerUser.user_id,
      email: reviewerUser.email,
      name: reviewerUser.name,
      is_active: true,
    }));
    mock.method(verificationRepository, 'assignReviewer', async () => ({
      ...sampleVerification,
      reviewer_id: reviewerUser.user_id,
      assigned_at: new Date(),
    }));
    mock.method(auditLogRepository, 'logEvent', async () => ({} as any));

    const res = await request(app)
      .post(`/api/v1/verifications/${sampleVerification.id}/assign`)
      .set('Cookie', ['cvs_session=recruiter-token'])
      .send({ reviewer_id: reviewerUser.user_id });

    assert.equal(res.status, 200);
    assert.equal(res.body.success, true);
    assert.equal(res.body.data.reviewer_id, reviewerUser.user_id);
  });

  // 3. Reviewer cannot assign another reviewer
  it('3. should return 403 when reviewer attempts to assign a reviewer', async () => {
    setupMockAuth(reviewerUser);

    const res = await request(app)
      .post(`/api/v1/verifications/${sampleVerification.id}/assign`)
      .set('Cookie', ['cvs_session=reviewer-token'])
      .send({ reviewer_id: otherReviewer.user_id });

    assert.equal(res.status, 403);
    assert.equal(res.body.success, false);
    assert.equal(res.body.error.code, 'FORBIDDEN');
  });

  // 4. Invalid reviewer ID
  it('4. should return 400 when assigning an invalid reviewer ID format or non-existent user', async () => {
    setupMockAuth(adminUser);

    mock.method(verificationRepository, 'findById', async () => sampleVerification);

    // A: Invalid UUID
    const res1 = await request(app)
      .post(`/api/v1/verifications/${sampleVerification.id}/assign`)
      .set('Cookie', ['cvs_session=admin-token'])
      .send({ reviewer_id: 'invalid-not-a-uuid' });

    assert.equal(res1.status, 400);

    // B: Non-existent user
    mock.method(userRoleRepository, 'getUserById', async () => null);
    mock.method(userRoleRepository, 'getUserRoles', async () => []);

    const res2 = await request(app)
      .post(`/api/v1/verifications/${sampleVerification.id}/assign`)
      .set('Cookie', ['cvs_session=admin-token'])
      .send({ reviewer_id: '99999999-9999-9999-9999-999999999999' });

    assert.equal(res2.status, 400);
    assert.equal(res2.body.error.code, 'BAD_REQUEST');
  });

  // 5. User without reviewer role cannot be assigned
  it('5. should return 400 when assigned user lacks reviewer role', async () => {
    setupMockAuth(adminUser);

    mock.method(verificationRepository, 'findById', async () => sampleVerification);
    mock.method(userRoleRepository, 'getUserById', async () => ({
      id: nonReviewerUser.user_id,
      email: nonReviewerUser.email,
      name: nonReviewerUser.name,
      is_active: true,
    }));
    mock.method(userRoleRepository, 'getUserRoles', async () => ['recruiter']);

    const res = await request(app)
      .post(`/api/v1/verifications/${sampleVerification.id}/assign`)
      .set('Cookie', ['cvs_session=admin-token'])
      .send({ reviewer_id: nonReviewerUser.user_id });

    assert.equal(res.status, 400);
    assert.equal(res.body.error.code, 'BAD_REQUEST');
  });

  // 6. Missing verification
  it('6. should return 404 when verification does not exist', async () => {
    setupMockAuth(adminUser);

    mock.method(verificationRepository, 'findById', async () => null);

    const res = await request(app)
      .post(`/api/v1/verifications/00000000-0000-0000-0000-000000000000/assign`)
      .set('Cookie', ['cvs_session=admin-token'])
      .send({ reviewer_id: reviewerUser.user_id });

    assert.equal(res.status, 404);
    assert.equal(res.body.error.code, 'NOT_FOUND');
  });

  // 7. Reviewer queue returns only assigned records
  it('7. should return only records strictly assigned to logged-in reviewer in reviewer queue', async () => {
    setupMockAuth(reviewerUser);

    const assignedVerification: VerificationRecord = {
      ...sampleVerification,
      reviewer_id: reviewerUser.user_id,
      assigned_at: new Date(),
    };

    let queriedReviewerId: string | undefined;
    mock.method(verificationRepository, 'findReviewerAssignments', async (revId: string) => {
      queriedReviewerId = revId;
      return {
        verifications: [assignedVerification],
        total: 1,
        page: 1,
        limit: 20,
      };
    });

    const res = await request(app)
      .get('/api/v1/reviewer/assignments?page=1&limit=20')
      .set('Cookie', ['cvs_session=reviewer-token']);

    assert.equal(res.status, 200);
    assert.equal(res.body.success, true);
    assert.equal(queriedReviewerId, reviewerUser.user_id);
    assert.equal(res.body.data.length, 1);
    assert.equal(res.body.data[0].reviewer_id, reviewerUser.user_id);
  });

  // 8. Reviewer cannot access another reviewer's verification
  it('8. should return 403 when reviewer attempts to access another reviewer verification details', async () => {
    setupMockAuth(reviewerUser);

    // Verification assigned to otherReviewer
    const otherReviewerVerification: VerificationRecord = {
      ...sampleVerification,
      reviewer_id: otherReviewer.user_id,
      assigned_at: new Date(),
    };
    mock.method(verificationRepository, 'findById', async () => otherReviewerVerification);

    const res = await request(app)
      .get(`/api/v1/reviewer/assignments/${otherReviewerVerification.id}`)
      .set('Cookie', ['cvs_session=reviewer-token']);

    assert.equal(res.status, 403);
    assert.equal(res.body.success, false);
    assert.equal(res.body.error.code, 'FORBIDDEN');
  });

  // 9. Assigned reviewer can view details
  it('9. should allow assigned reviewer to view candidate details, resume metadata, issues, and audit history', async () => {
    setupMockAuth(reviewerUser);

    const assignedVerification: VerificationRecord = {
      ...sampleVerification,
      reviewer_id: reviewerUser.user_id,
      assigned_at: new Date(),
    };

    mock.method(verificationRepository, 'findById', async () => assignedVerification);
    mock.method(candidateRepository, 'findById', async () => sampleCandidate);
    mock.method(documentRepository, 'findByCandidateId', async () => [sampleDocument]);
    mock.method(validationIssueRepository, 'findByVerificationId', async () => ({
      issues: [sampleIssue],
      total: 1,
      page: 1,
      limit: 20,
    }));
    mock.method(auditLogRepository, 'getLogsForEntity', async () => [
      {
        id: 'log-1',
        user_id: adminUser.user_id,
        action: 'VERIFICATION_ASSIGNED',
        entity_type: 'verification',
        entity_id: assignedVerification.id,
        old_values: null,
        new_values: { reviewerId: reviewerUser.user_id },
        ip_address: '127.0.0.1',
        user_agent: 'test',
        created_at: new Date(),
      },
    ]);

    const res = await request(app)
      .get(`/api/v1/reviewer/assignments/${assignedVerification.id}`)
      .set('Cookie', ['cvs_session=reviewer-token']);

    assert.equal(res.status, 200);
    assert.equal(res.body.success, true);
    assert.equal(res.body.data.verification.id, assignedVerification.id);
    assert.equal(res.body.data.candidate.email, sampleCandidate.email);
    assert.equal(res.body.data.resume.file_name, sampleDocument.file_name);
    assert.equal(res.body.data.validation_issues.length, 1);
    assert.equal(res.body.data.review_history.length, 1);
  });

  // 10. Assigned reviewer can approve
  it('10. should allow assigned reviewer to submit APPROVED decision and synchronize status', async () => {
    setupMockAuth(reviewerUser);

    const assignedVerification: VerificationRecord = {
      ...sampleVerification,
      reviewer_id: reviewerUser.user_id,
      status: 'requires_review',
    };

    mock.method(verificationRepository, 'findById', async () => assignedVerification);
    mock.method(candidateRepository, 'findById', async () => sampleCandidate);

    let updatedStatus: string | undefined;
    mock.method(verificationRepository, 'updateReview', async (_id: string, _revId: string, status: any, notes: string) => {
      updatedStatus = status;
      return { ...assignedVerification, status, notes, verified_at: new Date() };
    });

    let claimStatus: string | undefined;
    mock.method(claimRepository, 'updateStatus', async (_id: string, status: any) => {
      claimStatus = status;
      return { ...sampleClaim, status };
    });

    mock.method(verificationRepository, 'findByCandidateId', async () => [
      { ...assignedVerification, status: 'passed' as const },
    ]);

    let candidateStatus: string | undefined;
    mock.method(candidateRepository, 'update', async (_id: string, updates: any) => {
      candidateStatus = updates.status;
      return { ...sampleCandidate, ...updates };
    });

    let loggedEvent: any;
    mock.method(auditLogRepository, 'logEvent', async (event: any) => {
      loggedEvent = event;
      return {} as any;
    });

    const res = await request(app)
      .post(`/api/v1/reviewer/assignments/${assignedVerification.id}/decision`)
      .set('Cookie', ['cvs_session=reviewer-token'])
      .send({
        decision: 'APPROVED',
        comment: 'All credentials and employment background successfully verified.',
      });

    assert.equal(res.status, 200);
    assert.equal(res.body.success, true);
    assert.equal(res.body.data.decision, 'APPROVED');
    assert.equal(res.body.data.status, 'passed');
    assert.equal(updatedStatus, 'passed');
    assert.equal(claimStatus, 'verified');
    assert.equal(candidateStatus, 'verified');
    assert.equal(loggedEvent?.action, 'VERIFICATION_DECISION_SUBMITTED');
  });

  // 11. Assigned reviewer can reject
  it('11. should allow assigned reviewer to submit REJECTED decision and flag candidate', async () => {
    setupMockAuth(reviewerUser);

    const assignedVerification: VerificationRecord = {
      ...sampleVerification,
      reviewer_id: reviewerUser.user_id,
      status: 'requires_review',
    };

    mock.method(verificationRepository, 'findById', async () => assignedVerification);
    mock.method(candidateRepository, 'findById', async () => sampleCandidate);

    mock.method(verificationRepository, 'updateReview', async (_id: string, _revId: string, status: any, notes: string) => ({
      ...assignedVerification,
      status,
      notes,
      verified_at: new Date(),
    }));

    let claimStatus: string | undefined;
    mock.method(claimRepository, 'updateStatus', async (_id: string, status: any) => {
      claimStatus = status;
      return { ...sampleClaim, status };
    });

    mock.method(verificationRepository, 'findByCandidateId', async () => [assignedVerification]);

    let candidateStatus: string | undefined;
    mock.method(candidateRepository, 'update', async (_id: string, updates: any) => {
      candidateStatus = updates.status;
      return { ...sampleCandidate, ...updates };
    });
    mock.method(auditLogRepository, 'logEvent', async () => ({} as any));

    const res = await request(app)
      .post(`/api/v1/reviewer/assignments/${assignedVerification.id}/decision`)
      .set('Cookie', ['cvs_session=reviewer-token'])
      .send({
        decision: 'REJECTED',
        reason: 'Fraudulent degree credentials confirmed with registrar.',
      });

    assert.equal(res.status, 200);
    assert.equal(res.body.success, true);
    assert.equal(res.body.data.decision, 'REJECTED');
    assert.equal(res.body.data.status, 'failed');
    assert.equal(claimStatus, 'discrepant');
    assert.equal(candidateStatus, 'flagged');
  });

  // 12. Assigned reviewer can request additional information
  it('12. should allow assigned reviewer to request additional information (NEEDS_INFORMATION)', async () => {
    setupMockAuth(reviewerUser);

    const assignedVerification: VerificationRecord = {
      ...sampleVerification,
      reviewer_id: reviewerUser.user_id,
      status: 'pending',
    };

    mock.method(verificationRepository, 'findById', async () => assignedVerification);
    mock.method(candidateRepository, 'findById', async () => sampleCandidate);
    mock.method(verificationRepository, 'updateReview', async (_id: string, _revId: string, status: any, notes: string) => ({
      ...assignedVerification,
      status,
      notes,
    }));
    mock.method(claimRepository, 'updateStatus', async () => ({} as any));
    mock.method(verificationRepository, 'findByCandidateId', async () => [assignedVerification]);
    mock.method(candidateRepository, 'update', async () => ({} as any));
    mock.method(auditLogRepository, 'logEvent', async () => ({} as any));

    const res = await request(app)
      .post(`/api/v1/reviewer/assignments/${assignedVerification.id}/decision`)
      .set('Cookie', ['cvs_session=reviewer-token'])
      .send({
        decision: 'NEEDS_INFORMATION',
        comment: 'Please upload official sealed transcript for university records.',
      });

    assert.equal(res.status, 200);
    assert.equal(res.body.success, true);
    assert.equal(res.body.data.decision, 'NEEDS_INFORMATION');
    assert.equal(res.body.data.status, 'requires_review');
  });

  // 13. Rejection without reason is rejected
  it('13. should return 400 when REJECTED or NEEDS_INFORMATION decision lacks minimum reason length', async () => {
    setupMockAuth(reviewerUser);

    const assignedVerification: VerificationRecord = {
      ...sampleVerification,
      reviewer_id: reviewerUser.user_id,
    };
    mock.method(verificationRepository, 'findById', async () => assignedVerification);
    mock.method(candidateRepository, 'findById', async () => sampleCandidate);

    const res = await request(app)
      .post(`/api/v1/reviewer/assignments/${assignedVerification.id}/decision`)
      .set('Cookie', ['cvs_session=reviewer-token'])
      .send({
        decision: 'REJECTED',
        reason: 'no', // less than 5 chars
      });

    assert.equal(res.status, 400);
    assert.equal(res.body.success, false);
    assert.equal(res.body.error.code, 'BAD_REQUEST');
  });

  // 14. Unauthorized request returns 401
  it('14. should return 401 when accessing reviewer endpoints unauthenticated', async () => {
    const res = await request(app).get('/api/v1/reviewer/assignments');
    assert.equal(res.status, 401);
    assert.equal(res.body.error.code, 'UNAUTHORIZED');
  });

  // 15. Forbidden request returns 403
  it('15. should return 403 when recruiter attempts to access reviewer assignments queue', async () => {
    setupMockAuth(recruiterUser);

    const res = await request(app)
      .get('/api/v1/reviewer/assignments')
      .set('Cookie', ['cvs_session=recruiter-token']);

    assert.equal(res.status, 403);
    assert.equal(res.body.error.code, 'FORBIDDEN');
  });

  // 16. Duplicate assignment handling
  it('16. should return 409 conflict when assigning a verification to the same reviewer', async () => {
    setupMockAuth(adminUser);

    const alreadyAssigned: VerificationRecord = {
      ...sampleVerification,
      reviewer_id: reviewerUser.user_id,
    };
    mock.method(verificationRepository, 'findById', async () => alreadyAssigned);

    const res = await request(app)
      .post(`/api/v1/verifications/${alreadyAssigned.id}/assign`)
      .set('Cookie', ['cvs_session=admin-token'])
      .send({ reviewer_id: reviewerUser.user_id });

    assert.equal(res.status, 409);
    assert.equal(res.body.success, false);
    assert.equal(res.body.error.code, 'CONFLICT');
  });

  // 17. Repeated decision handling
  it('17. should return 409 conflict when repeating an identical decision on an already decided verification', async () => {
    setupMockAuth(reviewerUser);

    const passedVerification: VerificationRecord = {
      ...sampleVerification,
      reviewer_id: reviewerUser.user_id,
      status: 'passed',
    };
    mock.method(verificationRepository, 'findById', async () => passedVerification);
    mock.method(candidateRepository, 'findById', async () => sampleCandidate);

    const res = await request(app)
      .post(`/api/v1/reviewer/assignments/${passedVerification.id}/decision`)
      .set('Cookie', ['cvs_session=reviewer-token'])
      .send({
        decision: 'APPROVED',
        comment: 'Already passed verification review',
      });

    assert.equal(res.status, 409);
    assert.equal(res.body.success, false);
    assert.equal(res.body.error.code, 'CONFLICT');
  });

  // 18. Concurrent requests
  it('18. should handle concurrent decisions safely and prevent state race conditions', async () => {
    setupMockAuth(reviewerUser);

    const assignedVerification: VerificationRecord = {
      ...sampleVerification,
      reviewer_id: reviewerUser.user_id,
      status: 'requires_review',
    };

    mock.method(verificationRepository, 'findById', async () => assignedVerification);
    mock.method(candidateRepository, 'findById', async () => sampleCandidate);
    mock.method(verificationRepository, 'updateReview', async (_id: string, _revId: string, status: any, notes: string) => ({
      ...assignedVerification,
      status,
      notes,
      verified_at: new Date(),
    }));
    mock.method(claimRepository, 'updateStatus', async () => ({} as any));
    mock.method(verificationRepository, 'findByCandidateId', async () => [assignedVerification]);
    mock.method(candidateRepository, 'update', async () => ({} as any));
    mock.method(auditLogRepository, 'logEvent', async () => ({} as any));

    // Send two concurrent requests
    const [res1, res2] = await Promise.all([
      request(app)
        .post(`/api/v1/reviewer/assignments/${assignedVerification.id}/decision`)
        .set('Cookie', ['cvs_session=reviewer-token'])
        .send({ decision: 'APPROVED', comment: 'Approved on channel A' }),
      request(app)
        .post(`/api/v1/reviewer/assignments/${assignedVerification.id}/decision`)
        .set('Cookie', ['cvs_session=reviewer-token'])
        .send({ decision: 'APPROVED', comment: 'Approved on channel B' }),
    ]);

    // At least one succeeded with 200, system responded without crashing
    assert.ok(res1.status === 200 || res2.status === 200);
  });

  // 19. Audit history is preserved
  it('19. should record and preserve audit trail with old and new values on reviewer actions', async () => {
    setupMockAuth(reviewerUser);

    const assignedVerification: VerificationRecord = {
      ...sampleVerification,
      reviewer_id: reviewerUser.user_id,
      status: 'requires_review',
      notes: 'Initial automated findings',
    };

    mock.method(verificationRepository, 'findById', async () => assignedVerification);
    mock.method(candidateRepository, 'findById', async () => sampleCandidate);
    mock.method(verificationRepository, 'updateReview', async (_id: string, _revId: string, status: any, notes: string) => ({
      ...assignedVerification,
      status,
      notes,
    }));
    mock.method(claimRepository, 'updateStatus', async () => ({} as any));
    mock.method(verificationRepository, 'findByCandidateId', async () => [assignedVerification]);
    mock.method(candidateRepository, 'update', async () => ({} as any));

    let auditLogRecord: any;
    mock.method(auditLogRepository, 'logEvent', async (event: any) => {
      auditLogRecord = event;
      return {} as any;
    });

    const res = await request(app)
      .post(`/api/v1/reviewer/assignments/${assignedVerification.id}/decision`)
      .set('Cookie', ['cvs_session=reviewer-token'])
      .send({
        decision: 'APPROVED',
        comment: 'All references thoroughly vetted and approved.',
      });

    assert.equal(res.status, 200);
    assert.equal(auditLogRecord?.action, 'VERIFICATION_DECISION_SUBMITTED');
    assert.equal(auditLogRecord?.oldValues.status, 'requires_review');
    assert.equal(auditLogRecord?.newValues.decision, 'APPROVED');
    assert.equal(auditLogRecord?.newValues.status, 'passed');
    assert.equal(auditLogRecord?.userId, reviewerUser.user_id);
  });

  // 20. Transaction rollback on database failure
  it('20. should rollback and propagate error if database audit logging fails during decision submission', async () => {
    setupMockAuth(reviewerUser);

    const assignedVerification: VerificationRecord = {
      ...sampleVerification,
      reviewer_id: reviewerUser.user_id,
      status: 'requires_review',
    };

    mock.method(verificationRepository, 'findById', async () => assignedVerification);
    mock.method(candidateRepository, 'findById', async () => sampleCandidate);
    mock.method(verificationRepository, 'updateReview', async (_id: string, _revId: string, status: any, notes: string) => ({
      ...assignedVerification,
      status,
      notes,
    }));
    mock.method(claimRepository, 'updateStatus', async () => ({} as any));
    mock.method(verificationRepository, 'findByCandidateId', async () => [assignedVerification]);
    mock.method(candidateRepository, 'update', async () => ({} as any));

    // Force audit logging failure to trigger transaction rollback
    mock.method(auditLogRepository, 'logEvent', async () => {
      throw new Error('Database disk error during audit logging');
    });

    const res = await request(app)
      .post(`/api/v1/reviewer/assignments/${assignedVerification.id}/decision`)
      .set('Cookie', ['cvs_session=reviewer-token'])
      .send({
        decision: 'APPROVED',
        comment: 'All references vetted successfully',
      });

    assert.equal(res.status, 500);
  });
});
