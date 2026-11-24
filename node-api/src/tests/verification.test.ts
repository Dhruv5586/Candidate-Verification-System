import { describe, it, mock, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import request from 'supertest';
import { app } from '../app';
import { userRoleRepository } from '../repositories/userRole.repository';
import { claimRepository } from '../repositories/claim.repository';
import { verificationRepository } from '../repositories/verification.repository';
import { candidateRepository } from '../repositories/candidate.repository';
import { documentRepository } from '../repositories/document.repository';
import { extractionRepository } from '../repositories/extraction.repository';
import { validationIssueRepository } from '../repositories/validationIssue.repository';
import { auditLogRepository } from '../repositories/auditLog.repository';
import { CandidateClaimRecord, VerificationRecord } from '../types/verification.types';
import { CandidateRecord, DocumentRecord, ValidationIssueRecord } from '../types/candidate.types';

describe('Phase 9: Verification Workflow Test Suite', () => {
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

  const setupMockAuth = (userPayload: any) => {
    mock.method(globalThis, 'fetch', async () => {
      return new Response(JSON.stringify(userPayload), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      });
    });
    mock.method(userRoleRepository, 'getUserRoles', async (userId?: string) => {
      if (userId === otherReviewer.user_id) return otherReviewer.roles;
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
    status: 'pending',
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
    reviewer_id: '33333333-3333-3333-3333-333333333333',
    status: 'pending',
    priority: 'normal',
    notes: 'Verify previous employment records',
    assigned_at: new Date(),
    verified_at: null,
    created_at: new Date(),
    updated_at: new Date(),
  };

  it('1. should return 401 when accessing verifications unauthenticated', async () => {
    const res = await request(app).get('/api/v1/verifications');
    assert.equal(res.status, 401);
    assert.equal(res.body.success, false);
    assert.equal(res.body.error.code, 'UNAUTHORIZED');
  });

  it('2. should allow recruiter to add a credential claim to candidate', async () => {
    setupMockAuth(recruiterUser);

    mock.method(candidateRepository, 'findById', async () => sampleCandidate);
    mock.method(claimRepository, 'create', async () => sampleClaim);
    mock.method(auditLogRepository, 'logEvent', async () => ({} as any));

    const res = await request(app)
      .post(`/api/v1/candidates/${sampleCandidate.id}/claims`)
      .set('Cookie', ['cvs_session=recruiter-token'])
      .send({
        claim_type: 'employment',
        organization_name: 'Acme Technologies',
        title_or_degree: 'Senior Software Engineer',
        start_date: '2020-01-01',
        end_date: '2023-12-31',
      });

    assert.equal(res.status, 201);
    assert.equal(res.body.success, true);
    assert.equal(res.body.data.id, sampleClaim.id);
    assert.equal(res.body.data.status, 'unverified');
  });

  it('3. should allow reviewer to list candidate claims', async () => {
    setupMockAuth(reviewerUser);

    mock.method(candidateRepository, 'findById', async () => sampleCandidate);
    mock.method(claimRepository, 'findByCandidateId', async () => [sampleClaim]);

    const res = await request(app)
      .get(`/api/v1/candidates/${sampleCandidate.id}/claims`)
      .set('Cookie', ['cvs_session=reviewer-token']);

    assert.equal(res.status, 200);
    assert.equal(res.body.success, true);
    assert.equal(res.body.data.length, 1);
  });

  it('4. should create a verification task and transition candidate to in_progress', async () => {
    setupMockAuth(recruiterUser);

    mock.method(candidateRepository, 'findById', async () => sampleCandidate);
    mock.method(claimRepository, 'findById', async () => sampleClaim);
    mock.method(verificationRepository, 'create', async () => sampleVerification);

    let candidateStatusUpdated: string | undefined;
    mock.method(candidateRepository, 'update', async (_id: string, updates: any) => {
      candidateStatusUpdated = updates.status;
      return { ...sampleCandidate, ...updates };
    });
    mock.method(auditLogRepository, 'logEvent', async () => ({} as any));

    const res = await request(app)
      .post('/api/v1/verifications')
      .set('Cookie', ['cvs_session=recruiter-token'])
      .send({
        candidate_id: sampleCandidate.id,
        claim_id: sampleClaim.id,
        priority: 'high',
        notes: 'Priority verification required',
      });

    assert.equal(res.status, 201);
    assert.equal(res.body.success, true);
    assert.equal(res.body.data.id, sampleVerification.id);
    assert.equal(candidateStatusUpdated, 'in_progress');
  });

  it('5. should return 403 when recruiter attempts to access verification review queue (separation of duties)', async () => {
    setupMockAuth(recruiterUser);

    const res = await request(app)
      .get('/api/v1/verifications')
      .set('Cookie', ['cvs_session=recruiter-token']);

    assert.equal(res.status, 403);
    assert.equal(res.body.success, false);
    assert.equal(res.body.error.code, 'FORBIDDEN');
  });

  it('6. should allow reviewer to access verification review queue', async () => {
    setupMockAuth(reviewerUser);

    mock.method(verificationRepository, 'findQueue', async () => ({
      verifications: [sampleVerification],
      total: 1,
      page: 1,
      limit: 20,
    }));

    const res = await request(app)
      .get('/api/v1/verifications?page=1&limit=20')
      .set('Cookie', ['cvs_session=reviewer-token']);

    assert.equal(res.status, 200);
    assert.equal(res.body.success, true);
    assert.equal(res.body.data.length, 1);
    assert.equal(res.body.data[0].id, sampleVerification.id);
  });

  it('7. should return 403 when non-admin attempts to reassign verification reviewer', async () => {
    setupMockAuth(recruiterUser);

    const res = await request(app)
      .patch(`/api/v1/verifications/${sampleVerification.id}/assign`)
      .set('Cookie', ['cvs_session=recruiter-token'])
      .send({ reviewer_id: otherReviewer.user_id });

    assert.equal(res.status, 403);
    assert.equal(res.body.success, false);
  });

  it('8. should allow admin to reassign verification reviewer', async () => {
    setupMockAuth(adminUser);

    mock.method(verificationRepository, 'findById', async () => sampleVerification);
    mock.method(verificationRepository, 'assignReviewer', async () => ({
      ...sampleVerification,
      reviewer_id: otherReviewer.user_id,
    }));
    mock.method(auditLogRepository, 'logEvent', async () => ({} as any));

    const res = await request(app)
      .patch(`/api/v1/verifications/${sampleVerification.id}/assign`)
      .set('Cookie', ['cvs_session=admin-token'])
      .send({ reviewer_id: otherReviewer.user_id });

    assert.equal(res.status, 200);
    assert.equal(res.body.success, true);
    assert.equal(res.body.data.reviewer_id, otherReviewer.user_id);
  });

  it('9. should return 403 when recruiter attempts to submit review decision (separation of duties)', async () => {
    setupMockAuth(recruiterUser);

    const res = await request(app)
      .post(`/api/v1/verifications/${sampleVerification.id}/review`)
      .set('Cookie', ['cvs_session=recruiter-token'])
      .send({ status: 'passed', notes: 'Recruiter verifying self claim' });

    assert.equal(res.status, 403);
    assert.equal(res.body.success, false);
    assert.equal(res.body.error.code, 'FORBIDDEN');
  });

  it('10. should allow reviewer to submit passed review and synchronize claim and candidate status', async () => {
    setupMockAuth(reviewerUser);

    mock.method(verificationRepository, 'findById', async () => sampleVerification);

    let claimStatusUpdated: string | undefined;
    mock.method(claimRepository, 'updateStatus', async (_claimId: string, status: any) => {
      claimStatusUpdated = status;
      return { ...sampleClaim, status };
    });

    const passedVerification = { ...sampleVerification, status: 'passed' as const, notes: 'Employment confirmed' };
    mock.method(verificationRepository, 'updateReview', async () => passedVerification);
    mock.method(verificationRepository, 'findByCandidateId', async () => [passedVerification]);

    let candidateStatusUpdated: string | undefined;
    mock.method(candidateRepository, 'update', async (_candId: string, updates: any) => {
      candidateStatusUpdated = updates.status;
      return { ...sampleCandidate, ...updates };
    });
    mock.method(auditLogRepository, 'logEvent', async () => ({} as any));

    const res = await request(app)
      .post(`/api/v1/verifications/${sampleVerification.id}/review`)
      .set('Cookie', ['cvs_session=reviewer-token'])
      .send({
        status: 'passed',
        notes: 'Employment confirmed with HR department directly.',
      });

    assert.equal(res.status, 200);
    assert.equal(res.body.success, true);
    assert.equal(res.body.data.status, 'passed');
    assert.equal(claimStatusUpdated, 'verified');
    assert.equal(candidateStatusUpdated, 'verified');
  });

  it('11. should update candidate status to flagged when verification review is failed', async () => {
    setupMockAuth(reviewerUser);

    mock.method(verificationRepository, 'findById', async () => sampleVerification);

    let claimStatusUpdated: string | undefined;
    mock.method(claimRepository, 'updateStatus', async (_claimId: string, status: any) => {
      claimStatusUpdated = status;
      return { ...sampleClaim, status };
    });

    const failedVerification = { ...sampleVerification, status: 'failed' as const, notes: 'Candidate never worked here' };
    mock.method(verificationRepository, 'updateReview', async () => failedVerification);
    mock.method(verificationRepository, 'findByCandidateId', async () => [failedVerification]);

    let candidateStatusUpdated: string | undefined;
    mock.method(candidateRepository, 'update', async (_candId: string, updates: any) => {
      candidateStatusUpdated = updates.status;
      return { ...sampleCandidate, ...updates };
    });
    mock.method(auditLogRepository, 'logEvent', async () => ({} as any));

    const res = await request(app)
      .post(`/api/v1/verifications/${sampleVerification.id}/review`)
      .set('Cookie', ['cvs_session=reviewer-token'])
      .send({
        status: 'failed',
        notes: 'HR confirmed candidate never worked at Acme Technologies.',
      });

    assert.equal(res.status, 200);
    assert.equal(res.body.success, true);
    assert.equal(res.body.data.status, 'failed');
    assert.equal(claimStatusUpdated, 'discrepant');
    assert.equal(candidateStatusUpdated, 'flagged');
  });

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

  const sampleExtraction = {
    id: '50010000-0000-0000-0000-000000000005',
    document_id: '40010000-0000-0000-0000-000000000004',
    extracted_text: 'John Doe\njohn.doe@example.com\n+1-555-0123\nEducation\nBS Computer Science, State University, 2016 - 2020\nExperience\nSoftware Engineer, Acme Technologies, 2020 - 2023',
    extracted_data: {
      name: 'John Doe',
      email: 'john.doe@example.com',
      phone: '+1-555-0123',
      education: [{ degree: 'BS Computer Science', school: 'State University', year: '2020' }],
      experience: [{ title: 'Software Engineer', company: 'Acme Technologies', years: '2020-2023' }],
    },
    extraction_status: 'completed' as const,
    parser_name: 'test-parser',
    parser_version: '1.0.0',
    created_at: new Date(),
  };

  it('12. should return 401 when initiating verification without authentication', async () => {
    const res = await request(app)
      .post(`/api/v1/candidates/${sampleCandidate.id}/verifications`)
      .send({ priority: 'high' });

    assert.equal(res.status, 401);
    assert.equal(res.body.success, false);
    assert.equal(res.body.error.code, 'UNAUTHORIZED');
  });

  it('13. should return 403 when reviewer attempts to initiate verification', async () => {
    setupMockAuth(reviewerUser);

    const res = await request(app)
      .post(`/api/v1/candidates/${sampleCandidate.id}/verifications`)
      .set('Cookie', ['cvs_session=reviewer-token'])
      .send({ priority: 'normal' });

    assert.equal(res.status, 403);
    assert.equal(res.body.success, false);
    assert.equal(res.body.error.code, 'FORBIDDEN');
  });

  it('14. should return 404 when candidate is not found', async () => {
    setupMockAuth(recruiterUser);

    mock.method(candidateRepository, 'findById', async () => null);

    const res = await request(app)
      .post(`/api/v1/candidates/${sampleCandidate.id}/verifications`)
      .set('Cookie', ['cvs_session=recruiter-token'])
      .send({});

    assert.equal(res.status, 404);
    assert.equal(res.body.success, false);
    assert.equal(res.body.error.code, 'NOT_FOUND');
  });

  it('15. should return 404 when candidate is soft-deleted', async () => {
    setupMockAuth(recruiterUser);

    mock.method(candidateRepository, 'findById', async () => ({
      ...sampleCandidate,
      deleted_at: new Date(),
    }));

    const res = await request(app)
      .post(`/api/v1/candidates/${sampleCandidate.id}/verifications`)
      .set('Cookie', ['cvs_session=recruiter-token'])
      .send({});

    assert.equal(res.status, 404);
    assert.equal(res.body.success, false);
    assert.equal(res.body.error.code, 'NOT_FOUND');
  });

  it('16. should return 403 when recruiter attempts to verify candidate belonging to another recruiter', async () => {
    setupMockAuth(recruiterUser);

    mock.method(candidateRepository, 'findById', async () => ({
      ...sampleCandidate,
      created_by: '99999999-9999-9999-9999-999999999999',
    }));

    const res = await request(app)
      .post(`/api/v1/candidates/${sampleCandidate.id}/verifications`)
      .set('Cookie', ['cvs_session=recruiter-token'])
      .send({});

    assert.equal(res.status, 403);
    assert.equal(res.body.success, false);
    assert.equal(res.body.error.code, 'FORBIDDEN');
  });

  it('17. should return 400 when candidate has no uploaded resume document', async () => {
    setupMockAuth(recruiterUser);

    mock.method(candidateRepository, 'findById', async () => sampleCandidate);
    mock.method(documentRepository, 'findByCandidateId', async () => []);

    const res = await request(app)
      .post(`/api/v1/candidates/${sampleCandidate.id}/verifications`)
      .set('Cookie', ['cvs_session=recruiter-token'])
      .send({});

    assert.equal(res.status, 400);
    assert.equal(res.body.success, false);
    assert.equal(res.body.error.code, 'BAD_REQUEST');
  });

  it('18. should return 409 conflict when an active verification already exists for candidate', async () => {
    setupMockAuth(recruiterUser);

    mock.method(candidateRepository, 'findById', async () => sampleCandidate);
    mock.method(documentRepository, 'findByCandidateId', async () => [sampleDocument]);
    mock.method(verificationRepository, 'findActiveByCandidateId', async () => sampleVerification);

    const res = await request(app)
      .post(`/api/v1/candidates/${sampleCandidate.id}/verifications`)
      .set('Cookie', ['cvs_session=recruiter-token'])
      .send({});

    assert.equal(res.status, 409);
    assert.equal(res.body.success, false);
    assert.equal(res.body.error.code, 'CONFLICT');
  });

  it('19. should initiate verification successfully, execute automated screening checks, and record issues', async () => {
    setupMockAuth(recruiterUser);

    mock.method(candidateRepository, 'findById', async () => sampleCandidate);
    mock.method(documentRepository, 'findByCandidateId', async () => [sampleDocument]);
    mock.method(verificationRepository, 'findActiveByCandidateId', async () => null);

    const newVerification: VerificationRecord = {
      id: '30010000-0000-0000-0000-000000000099',
      candidate_id: sampleCandidate.id,
      claim_id: null,
      reviewer_id: null,
      status: 'pending',
      priority: 'high',
      notes: null,
      assigned_at: null,
      verified_at: null,
      created_at: new Date(),
      updated_at: new Date(),
    };

    mock.method(verificationRepository, 'create', async () => newVerification);
    mock.method(validationIssueRepository, 'deleteByVerificationId', async () => 0);

    // Extraction with missing phone issue
    const extractionWithMissingPhone = {
      ...sampleExtraction,
      extracted_text: 'John Doe\njohn.doe@example.com\nEducation\nBS Computer Science, 2020\nExperience\nDeveloper 2021',
      extracted_data: {
        name: 'John Doe',
        email: 'john.doe@example.com',
      },
    };
    mock.method(extractionRepository, 'findByDocumentId', async () => extractionWithMissingPhone);

    const createdIssues: any[] = [];
    mock.method(validationIssueRepository, 'create', async (data: any) => {
      const issue: ValidationIssueRecord = {
        id: `issue-${createdIssues.length + 1}`,
        ...data,
        resolved: false,
        created_at: new Date(),
        updated_at: new Date(),
      };
      createdIssues.push(issue);
      return issue;
    });

    let statusUpdatedTo: string | undefined;
    mock.method(verificationRepository, 'updateStatus', async (id: string, status: any) => {
      statusUpdatedTo = status;
      return { ...newVerification, status };
    });

    let candidateStatusUpdated: string | undefined;
    mock.method(candidateRepository, 'update', async (id: string, updates: any) => {
      candidateStatusUpdated = updates.status;
      return { ...sampleCandidate, ...updates };
    });

    let loggedEvent: any;
    mock.method(auditLogRepository, 'logEvent', async (event: any) => {
      loggedEvent = event;
      return {} as any;
    });

    const res = await request(app)
      .post(`/api/v1/candidates/${sampleCandidate.id}/verifications`)
      .set('Cookie', ['cvs_session=recruiter-token'])
      .send({ priority: 'high', notes: 'Urgent candidate verification' });

    assert.equal(res.status, 201);
    assert.equal(res.body.success, true);
    assert.equal(res.body.data.id, newVerification.id);
    assert.equal(res.body.data.priority, 'high');
    assert.equal(res.body.data.total_issues > 0, true);
    assert.equal(statusUpdatedTo, 'requires_review');
    assert.equal(candidateStatusUpdated, 'in_progress');
    assert.equal(loggedEvent?.action, 'CANDIDATE_VERIFICATION_INITIATED');
  });

  it('20. should detect EMPTY_OR_UNREADABLE_DOCUMENT when resume text is empty or unreadable', async () => {
    setupMockAuth(recruiterUser);

    mock.method(candidateRepository, 'findById', async () => sampleCandidate);
    mock.method(documentRepository, 'findByCandidateId', async () => [sampleDocument]);
    mock.method(verificationRepository, 'findActiveByCandidateId', async () => null);

    const newVerification: VerificationRecord = {
      ...sampleVerification,
      id: '30010000-0000-0000-0000-000000000088',
      status: 'pending',
    };
    mock.method(verificationRepository, 'create', async () => newVerification);
    mock.method(validationIssueRepository, 'deleteByVerificationId', async () => 0);

    // Extraction with completely empty extracted_text
    const emptyExtraction = {
      ...sampleExtraction,
      extracted_text: '    ',
      extracted_data: {},
    };
    mock.method(extractionRepository, 'findByDocumentId', async () => emptyExtraction);

    const createdIssues: any[] = [];
    mock.method(validationIssueRepository, 'create', async (data: any) => {
      createdIssues.push(data);
      return { id: 'issue-empty-1', ...data, resolved: false, created_at: new Date(), updated_at: new Date() };
    });

    mock.method(verificationRepository, 'updateStatus', async (id: string, status: any) => ({
      ...newVerification,
      status,
    }));
    mock.method(candidateRepository, 'update', async (_id: string, updates: any) => ({ ...sampleCandidate, ...updates }));
    mock.method(auditLogRepository, 'logEvent', async () => ({} as any));

    const res = await request(app)
      .post(`/api/v1/candidates/${sampleCandidate.id}/verifications`)
      .set('Cookie', ['cvs_session=recruiter-token'])
      .send({});

    assert.equal(res.status, 201);
    const hasEmptyDocIssue = createdIssues.some(
      (iss) => (iss.issueType || iss.issue_type) === 'EMPTY_OR_UNREADABLE_DOCUMENT'
    );
    assert.equal(hasEmptyDocIssue, true);
  });

  it('21. should detect date anomalies (INVALID_DATE_RANGE and FUTURE_DATE_ANOMALY)', async () => {
    setupMockAuth(recruiterUser);

    mock.method(candidateRepository, 'findById', async () => sampleCandidate);
    mock.method(documentRepository, 'findByCandidateId', async () => [sampleDocument]);
    mock.method(verificationRepository, 'findActiveByCandidateId', async () => null);

    const newVerification: VerificationRecord = {
      ...sampleVerification,
      id: '30010000-0000-0000-0000-000000000077',
      status: 'pending',
    };
    mock.method(verificationRepository, 'create', async () => newVerification);
    mock.method(validationIssueRepository, 'deleteByVerificationId', async () => 0);

    // Text with future date anomaly (2099) and inverted date range (2025 - 2021)
    const anomalousExtraction = {
      ...sampleExtraction,
      extracted_text: 'John Doe\njohn.doe@example.com\n+1-555-0123\nEducation\nBS Computer Science, 2099\nExperience\nSoftware Engineer, 2025 - 2021',
      extracted_data: {
        name: 'John Doe',
        email: 'john.doe@example.com',
        phone: '+1-555-0123',
      },
    };
    mock.method(extractionRepository, 'findByDocumentId', async () => anomalousExtraction);

    const recordedTypes: string[] = [];
    mock.method(validationIssueRepository, 'create', async (data: any) => {
      recordedTypes.push(data.issueType || data.issue_type);
      return { id: 'anomaly-issue', ...data, resolved: false, created_at: new Date(), updated_at: new Date() };
    });

    mock.method(verificationRepository, 'updateStatus', async (id: string, status: any) => ({
      ...newVerification,
      status,
    }));
    mock.method(candidateRepository, 'update', async (_id: string, updates: any) => ({ ...sampleCandidate, ...updates }));
    mock.method(auditLogRepository, 'logEvent', async () => ({} as any));

    const res = await request(app)
      .post(`/api/v1/candidates/${sampleCandidate.id}/verifications`)
      .set('Cookie', ['cvs_session=recruiter-token'])
      .send({});

    assert.equal(res.status, 201);
    assert.equal(recordedTypes.includes('FUTURE_DATE_ANOMALY'), true);
    assert.equal(recordedTypes.includes('INVALID_DATE_RANGE'), true);
  });

  it('22. should return verifications list for candidate (GET /api/v1/candidates/:id/verifications)', async () => {
    setupMockAuth(adminUser);

    mock.method(candidateRepository, 'findById', async () => sampleCandidate);
    mock.method(verificationRepository, 'findByCandidateId', async () => [sampleVerification]);

    const res = await request(app)
      .get(`/api/v1/candidates/${sampleCandidate.id}/verifications`)
      .set('Cookie', ['cvs_session=admin-token']);

    assert.equal(res.status, 200);
    assert.equal(res.body.success, true);
    assert.equal(Array.isArray(res.body.data), true);
    assert.equal(res.body.data.length, 1);
    assert.equal(res.body.data[0].id, sampleVerification.id);
  });

  it('23. should return verification details (GET /api/v1/verifications/:id)', async () => {
    setupMockAuth(recruiterUser);

    mock.method(verificationRepository, 'findById', async () => sampleVerification);
    mock.method(candidateRepository, 'findById', async () => sampleCandidate);

    const res = await request(app)
      .get(`/api/v1/verifications/${sampleVerification.id}`)
      .set('Cookie', ['cvs_session=recruiter-token']);

    assert.equal(res.status, 200);
    assert.equal(res.body.success, true);
    assert.equal(res.body.data.id, sampleVerification.id);
    assert.equal(res.body.data.candidate_id, sampleCandidate.id);
  });

  it('24. should return verification validation issues with pagination (GET /api/v1/verifications/:id/issues)', async () => {
    setupMockAuth(reviewerUser);

    mock.method(verificationRepository, 'findById', async () => sampleVerification);
    mock.method(candidateRepository, 'findById', async () => sampleCandidate);

    const sampleIssues: ValidationIssueRecord[] = [
      {
        id: 'iss-1',
        verification_id: sampleVerification.id,
        candidate_id: sampleCandidate.id,
        document_id: sampleDocument.id,
        issue_type: 'PHONE_NOT_DETECTED',
        severity: 'medium',
        description: 'Candidate phone number was not detected in resume text.',
        resolved: false,
        status: 'open',
        created_at: new Date(),
        updated_at: new Date(),
      },
    ];

    mock.method(validationIssueRepository, 'findByVerificationId', async () => ({
      issues: sampleIssues,
      total: 1,
      page: 1,
      limit: 10,
    }));

    const res = await request(app)
      .get(`/api/v1/verifications/${sampleVerification.id}/issues?page=1&limit=10`)
      .set('Cookie', ['cvs_session=reviewer-token']);

    assert.equal(res.status, 200);
    assert.equal(res.body.success, true);
    assert.equal(Array.isArray(res.body.data), true);
    assert.equal(res.body.data.length, 1);
    assert.equal(res.body.pagination.total, 1);
    assert.equal(res.body.pagination.page, 1);
  });

  it('25. should record audit log with CANDIDATE_VERIFICATION_INITIATED', async () => {
    setupMockAuth(adminUser);

    mock.method(candidateRepository, 'findById', async () => sampleCandidate);
    mock.method(documentRepository, 'findByCandidateId', async () => [sampleDocument]);
    mock.method(verificationRepository, 'findActiveByCandidateId', async () => null);

    const newVerification: VerificationRecord = {
      ...sampleVerification,
      id: '30010000-0000-0000-0000-000000000055',
    };
    mock.method(verificationRepository, 'create', async () => newVerification);
    mock.method(validationIssueRepository, 'deleteByVerificationId', async () => 0);
    mock.method(extractionRepository, 'findByDocumentId', async () => sampleExtraction);
    mock.method(validationIssueRepository, 'create', async (data: any) => ({
      id: 'iss-audit',
      ...data,
      resolved: false,
      created_at: new Date(),
      updated_at: new Date(),
    }));
    mock.method(verificationRepository, 'updateStatus', async (id: string, status: any) => ({
      ...newVerification,
      status,
    }));
    mock.method(candidateRepository, 'update', async (_id: string, updates: any) => ({ ...sampleCandidate, ...updates }));

    let loggedEvent: any;
    mock.method(auditLogRepository, 'logEvent', async (event: any) => {
      loggedEvent = event;
      return {} as any;
    });

    const res = await request(app)
      .post(`/api/v1/candidates/${sampleCandidate.id}/verifications`)
      .set('Cookie', ['cvs_session=admin-token'])
      .send({});

    assert.equal(res.status, 201);
    assert.equal(loggedEvent?.action, 'CANDIDATE_VERIFICATION_INITIATED');
    assert.equal(loggedEvent?.userId, adminUser.user_id);
  });

  it('26. should safely delete previous issues on rerun without duplicate issues', async () => {
    setupMockAuth(recruiterUser);

    mock.method(candidateRepository, 'findById', async () => sampleCandidate);
    mock.method(documentRepository, 'findByCandidateId', async () => [sampleDocument]);
    mock.method(verificationRepository, 'findActiveByCandidateId', async () => null);

    const newVerification: VerificationRecord = {
      ...sampleVerification,
      id: '30010000-0000-0000-0000-000000000044',
    };
    mock.method(verificationRepository, 'create', async () => newVerification);

    let deletedVerificationId: string | undefined;
    mock.method(validationIssueRepository, 'deleteByVerificationId', async (verId: string) => {
      deletedVerificationId = verId;
      return 3;
    });

    mock.method(extractionRepository, 'findByDocumentId', async () => sampleExtraction);
    mock.method(validationIssueRepository, 'create', async (data: any) => ({
      id: 'iss-rerun',
      ...data,
      resolved: false,
      created_at: new Date(),
      updated_at: new Date(),
    }));
    mock.method(verificationRepository, 'updateStatus', async (id: string, status: any) => ({
      ...newVerification,
      status,
    }));
    mock.method(candidateRepository, 'update', async (_id: string, updates: any) => ({ ...sampleCandidate, ...updates }));
    mock.method(auditLogRepository, 'logEvent', async () => ({} as any));

    const res = await request(app)
      .post(`/api/v1/candidates/${sampleCandidate.id}/verifications`)
      .set('Cookie', ['cvs_session=recruiter-token'])
      .send({});

    assert.equal(res.status, 201);
    assert.equal(deletedVerificationId, newVerification.id);
  });
});
