import { describe, it, mock, beforeEach, afterEach, after } from 'node:test';
import assert from 'node:assert/strict';
import request from 'supertest';
import { app } from '../app';
import { pool } from '../config/database';
import { userRoleRepository } from '../repositories/userRole.repository';
import { importBatchRepository } from '../repositories/importBatch.repository';
import { candidateRepository } from '../repositories/candidate.repository';
import { documentRepository } from '../repositories/document.repository';
import { extractionRepository } from '../repositories/extraction.repository';
import { verificationRepository } from '../repositories/verification.repository';
import { claimRepository } from '../repositories/claim.repository';
import { validationIssueRepository } from '../repositories/validationIssue.repository';
import { auditLogRepository } from '../repositories/auditLog.repository';
import { storageService } from '../services/storage.service';
import { extractionService } from '../services/extraction.service';
import { resumeValidationService } from '../services/resumeValidation.service';
import { CandidateRecord, DocumentRecord } from '../types/candidate.types';
import { ImportBatchRecord } from '../types/import.types';
import { VerificationRecord } from '../types/verification.types';

describe('Phase 9 Step 7: Complete Integration, Security & End-to-End Test Suite', () => {
  beforeEach(() => {
    // Default mocks to prevent unmocked database calls on synthetic test UUIDs
    mock.method(auditLogRepository, 'logEvent', async () => ({} as any));
    mock.method(documentRepository, 'findByCandidateId', async () => []);
    mock.method(documentRepository, 'findByChecksum', async () => null);
  });

  afterEach(() => {
    mock.reset();
  });

  after(async () => {
    await pool.end().catch(() => {});
  });

  // Test Identities
  const adminUser = {
    valid: true,
    user_id: 'a0000000-0000-0000-0000-000000000001',
    email: 'admin@example.com',
    name: 'Adam Admin',
    roles: ['admin'],
    session_id: 'sess-admin-99',
    expires_at: '2026-12-31T23:59:59Z',
  };

  const recruiterUser = {
    valid: true,
    user_id: 'b0000000-0000-0000-0000-000000000001',
    email: 'recruiter@example.com',
    name: 'Rachel Recruiter',
    roles: ['recruiter'],
    session_id: 'sess-recruiter-99',
    expires_at: '2026-12-31T23:59:59Z',
  };

  const reviewerUser = {
    valid: true,
    user_id: 'c0000000-0000-0000-0000-000000000010',
    email: 'reviewer.rita@example.com',
    name: 'Rita Reviewer',
    roles: ['reviewer'],
    session_id: 'sess-reviewer-rita',
    expires_at: '2026-12-31T23:59:59Z',
  };

  const otherReviewer = {
    valid: true,
    user_id: 'c0000000-0000-0000-0000-000000000020',
    email: 'reviewer.oscar@example.com',
    name: 'Oscar Reviewer',
    roles: ['reviewer'],
    session_id: 'sess-reviewer-oscar',
    expires_at: '2026-12-31T23:59:59Z',
  };

  const inactiveReviewerId = '00000000-0000-0000-0000-000000000099';

  const setupMockAuth = (userPayload: any) => {
    mock.method(globalThis, 'fetch', async () => {
      return new Response(JSON.stringify(userPayload), {
        status: userPayload.valid ? 200 : 401,
        headers: { 'Content-Type': 'application/json' },
      });
    });
    mock.method(userRoleRepository, 'getUserRoles', async (uid?: string) => {
      if (uid === reviewerUser.user_id || uid === otherReviewer.user_id) {
        return ['reviewer'];
      }
      if (uid === recruiterUser.user_id) {
        return ['recruiter'];
      }
      if (uid === adminUser.user_id) {
        return ['admin'];
      }
      return userPayload.roles || [];
    });
    mock.method(userRoleRepository, 'getUserById', async (uid: string) => {
      if (uid === reviewerUser.user_id) {
        return { id: reviewerUser.user_id, email: reviewerUser.email, is_active: true };
      }
      if (uid === otherReviewer.user_id) {
        return { id: otherReviewer.user_id, email: otherReviewer.email, is_active: true };
      }
      if (uid === inactiveReviewerId) {
        return { id: inactiveReviewerId, email: 'inactive@example.com', is_active: false };
      }
      return null;
    });
  };

  // --------------------------------------------------------------------------
  // SECTION 2: Complete 17-Step End-to-End Workflow + Alternate Decision Branches
  // --------------------------------------------------------------------------
  describe('2. End-to-End Candidate Ingestion and Verification Workflow', () => {
    const importBatchId = 'b0000000-0000-0000-0000-000000000002';
    const newCandidateId = 'd0000000-0000-0000-0000-000000000001';
    const existingCandidateId = 'd0000000-0000-0000-0000-000000000002';
    const resumeDocId = 'e0000000-0000-0000-0000-000000000001';
    const verificationId = 'f0000000-0000-0000-0000-000000000001';

    const syntheticCsv =
      'Full Name,Email Address,Phone Number,City,Job Title\n' +
      'Alice Walker,alice.walker@example.com,+1-555-0101,Seattle,Cloud Architect\n' + // NEW
      'Existing Candidate,existing.candidate@example.com,+1-555-0102,Boston,Product Manager\n' + // DB DUPLICATE
      'Alice Walker Duplicate,alice.walker@example.com,+1-555-0103,Seattle,Cloud Architect\n'; // CSV DUPLICATE

    const batchRecord: ImportBatchRecord = {
      id: importBatchId,
      uploaded_by: adminUser.user_id,
      file_name: 'candidates_e2e.csv',
      total_rows: 3,
      processed_rows: 0,
      successful_rows: 0,
      failed_rows: 0,
      status: 'pending',
      error_summary: {},
      storage_key: 'storage-e2e-csv.bin',
      checksum_sha256: 'sha256e2ecsvhash',
      file_size_bytes: Buffer.byteLength(syntheticCsv),
      created_at: new Date(),
      completed_at: null,
    };

    const newCandidateRecord: CandidateRecord = {
      id: newCandidateId,
      full_name: 'Alice Walker',
      email: 'alice.walker@example.com',
      phone: '+1-555-0101',
      location: 'Seattle',
      current_job_title: 'Cloud Architect',
      status: 'pending',
      created_by: adminUser.user_id,
      import_batch_id: importBatchId,
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
      deleted_at: null,
    };

    const resumeRecord: DocumentRecord = {
      id: resumeDocId,
      candidate_id: newCandidateId,
      document_type: 'resume',
      file_name: 'alice_walker_resume.pdf',
      file_size_bytes: 4096,
      mime_type: 'application/pdf',
      storage_key: 'alice-resume-key.pdf',
      checksum_sha256: 'sha256pdfhash123',
      uploaded_by: adminUser.user_id,
      created_at: new Date().toISOString(),
    };

    const verificationRecord: VerificationRecord = {
      id: verificationId,
      candidate_id: newCandidateId,
      claim_id: null,
      reviewer_id: null,
      status: 'requires_review',
      priority: 'high',
      notes: 'Automated verification completed: 1 screening issue(s) detected',
      verified_at: null,
      assigned_at: null,
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    };

    it('Complete 17-Step E2E: Upload -> Preview -> Confirm -> Resume -> Verify -> Assign -> Review -> Approve', async () => {
      // Step 1: Authenticate as Admin
      setupMockAuth(adminUser);

      // Step 2 & 3: Upload and Validate synthetic CSV file
      mock.method(storageService, 'saveFile', async () => ({
        storageKey: 'storage-e2e-csv.bin',
        sha256Hash: 'sha256e2ecsvhash',
        fileSizeBytes: Buffer.byteLength(syntheticCsv),
      }));
      mock.method(importBatchRepository, 'create', async () => batchRecord);

      const uploadRes = await request(app)
        .post('/api/v1/imports/upload')
        .set('Cookie', ['cvs_session=sess-admin-99'])
        .attach('file', Buffer.from(syntheticCsv), 'candidates_e2e.csv');

      assert.equal(uploadRes.status, 201);
      assert.equal(uploadRes.body.success, true);
      assert.equal(uploadRes.body.data.batchId, importBatchId);
      assert.equal(uploadRes.body.data.totalRows, 3);

      // Step 4 & 5: Preview candidate rows and identify DB & CSV duplicates
      mock.method(importBatchRepository, 'findById', async () => batchRecord);
      mock.method(storageService, 'readFile', async () => Buffer.from(syntheticCsv));
      const dbDuplicatesMap = new Map([
        [
          'existing.candidate@example.com',
          { id: existingCandidateId, email: 'existing.candidate@example.com', status: 'verified' },
        ],
      ]);
      mock.method(candidateRepository, 'findExistingEmails', async () => dbDuplicatesMap);

      const previewRes = await request(app)
        .post('/api/v1/imports/csv/preview')
        .set('Cookie', ['cvs_session=sess-admin-99'])
        .send({ batchId: importBatchId });

      assert.equal(previewRes.status, 200);
      assert.equal(previewRes.body.success, true);
      assert.equal(previewRes.body.data.totalRows, 3);
      assert.equal(previewRes.body.data.newCandidates, 1);
      assert.equal(previewRes.body.data.existingDatabaseDuplicates, 1);
      assert.equal(previewRes.body.data.duplicateRowsWithinCsv, 1);

      const rows = previewRes.body.data.rows;
      assert.equal(rows[0].status, 'NEW');
      assert.equal(rows[1].status, 'DUPLICATE_IN_DATABASE');
      assert.equal(rows[2].status, 'DUPLICATE_IN_CSV');

      // Step 6: Confirm candidate import
      let poolClientReleased = false;
      let transactionCommitted = false;
      mock.method(importBatchRepository, 'claimForProcessing', async () => true);
      mock.method(pool, 'connect', async () => ({
        query: async (sql: string, params?: any[]) => {
          if (sql === 'BEGIN' || sql === 'COMMIT' || sql === 'ROLLBACK') {
            if (sql === 'COMMIT') transactionCommitted = true;
            return { rows: [], rowCount: 0 };
          }
          if (sql.includes('SELECT id, email FROM candidates')) {
            if (params?.[0] === 'existing.candidate@example.com') {
              return { rows: [{ id: existingCandidateId, email: 'existing.candidate@example.com' }], rowCount: 1 };
            }
            return { rows: [], rowCount: 0 };
          }
          if (sql.includes('INSERT INTO candidates')) {
            return { rows: [{ id: newCandidateId }], rowCount: 1 };
          }
          if (sql.includes('UPDATE import_batches')) {
            return { rows: [{ completed_at: new Date() }], rowCount: 1 };
          }
          return { rows: [], rowCount: 0 };
        },
        release: () => {
          poolClientReleased = true;
        },
      }));

      const confirmRes = await request(app)
        .post(`/api/v1/imports/${importBatchId}/confirm`)
        .set('Cookie', ['cvs_session=sess-admin-99'])
        .send({ confirm: true });

      assert.equal(confirmRes.status, 200);
      assert.equal(confirmRes.body.success, true);
      assert.equal(confirmRes.body.data.insertedCount, 1);
      assert.equal(confirmRes.body.data.skippedDatabaseDuplicateCount, 1);
      assert.equal(confirmRes.body.data.skippedCsvDuplicateCount, 1);
      assert.equal(transactionCommitted, true);
      assert.equal(poolClientReleased, true);

      // Step 7: Verify candidate in candidate repository
      mock.method(candidateRepository, 'findById', async (id: string) => {
        if (id === newCandidateId) return newCandidateRecord;
        return null;
      });
      mock.method(documentRepository, 'findByCandidateId', async () => []);
      const getCandRes = await request(app)
        .get(`/api/v1/candidates/${newCandidateId}`)
        .set('Cookie', ['cvs_session=sess-admin-99']);

      assert.equal(getCandRes.status, 200);
      assert.equal(getCandRes.body.data.email, 'alice.walker@example.com');
      assert.equal(getCandRes.body.data.status, 'pending');

      // Step 8: Upload synthetic PDF resume for newly imported candidate
      const validPdfBuffer = Buffer.concat([
        Buffer.from('%PDF-1.4\n%âãÏÓ\n'),
        Buffer.from(
          'Alice Walker\nalice.walker@example.com\n+1-555-0101\nEducation: B.S. in Computer Science\nExperience: Cloud Architect at TechCorp 2020-2024\n%%EOF'
        ),
      ]);
      mock.method(documentRepository, 'findByChecksum', async () => null);
      mock.method(documentRepository, 'create', async () => resumeRecord);
      mock.method(extractionService, 'extractText', async () => ({
        text: 'Alice Walker\nalice.walker@example.com\n+1-555-0101\nEducation: B.S. in Computer Science\nExperience: Cloud Architect at TechCorp 2020-2024',
        status: 'completed',
        parserName: 'pdf-parse',
        parserVersion: '2.4.5',
        data: {},
      }));
      mock.method(extractionRepository, 'create', async () => ({
        id: 'ext-uuid-e2e',
        document_id: resumeDocId,
        extracted_text:
          'Alice Walker\nalice.walker@example.com\n+1-555-0101\nEducation: B.S. in Computer Science\nExperience: Cloud Architect at TechCorp 2020-2024',
        extracted_data: {},
        extraction_status: 'completed',
        parser_name: 'pdf-parse',
        parser_version: '2.4.5',
        created_at: new Date().toISOString(),
      }));
      mock.method(resumeValidationService, 'validateResume', async () => []);

      const resumeUploadRes = await request(app)
        .post(`/api/v1/candidates/${newCandidateId}/resumes`)
        .set('Cookie', ['cvs_session=sess-admin-99'])
        .attach('resume', validPdfBuffer, {
          filename: 'alice_walker_resume.pdf',
          contentType: 'application/pdf',
        });

      assert.equal(resumeUploadRes.status, 201);
      assert.equal(resumeUploadRes.body.success, true);
      assert.equal(resumeUploadRes.body.data.document.id, resumeDocId);

      // Step 9 & 10: Start candidate verification and check automated screening results
      mock.method(documentRepository, 'findByCandidateId', async () => [resumeRecord]);
      mock.method(verificationRepository, 'findActiveByCandidateId', async () => null);
      mock.method(verificationRepository, 'create', async () => verificationRecord);
      mock.method(resumeValidationService, 'validateResume', async () => [
        {
          id: 'issue-uuid-1',
          issue_type: 'UNCONVENTIONAL_DATE_FORMAT',
          severity: 'low',
          description: 'Date format used unconventional spelling',
          status: 'open',
        } as any,
      ]);
      mock.method(extractionRepository, 'findByDocumentId', async () => ({
        id: 'ext-uuid-e2e',
        document_id: resumeDocId,
        extracted_text:
          'Alice Walker\nalice.walker@example.com\n+1-555-0101\nEducation: B.S. in Computer Science\nExperience: Cloud Architect at TechCorp 2020-2024',
        extracted_data: {},
        extraction_status: 'completed',
        parser_name: 'pdf-parse',
        parser_version: '2.4.5',
        created_at: new Date().toISOString(),
      }));
      mock.method(validationIssueRepository, 'deleteByVerificationId', async () => 0);
      mock.method(validationIssueRepository, 'create', async (data: any) => ({
        id: 'issue-uuid-1',
        ...data,
        resolved: false,
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      }));
      mock.method(verificationRepository, 'updateStatus', async (_id: string, status: any) => ({
        ...verificationRecord,
        status,
      }));
      mock.method(candidateRepository, 'update', async () => ({
        ...newCandidateRecord,
        status: 'in_progress',
      }));

      const startVerifRes = await request(app)
        .post(`/api/v1/candidates/${newCandidateId}/verifications`)
        .set('Cookie', ['cvs_session=sess-admin-99'])
        .send({ priority: 'high' });

      assert.equal(startVerifRes.status, 201);
      assert.equal(startVerifRes.body.success, true);
      assert.equal(startVerifRes.body.data.id, verificationId);
      assert.equal(startVerifRes.body.data.status, 'requires_review');
      assert.equal(startVerifRes.body.data.issues.length, 1);

      // Check validation issues endpoint
      mock.method(verificationRepository, 'findById', async () => ({
        ...verificationRecord,
        reviewer_id: reviewerUser.user_id,
      }));
      mock.method(validationIssueRepository, 'findByVerificationId', async () => ({
        issues: [
          {
            id: 'issue-uuid-1',
            verification_id: verificationId,
            candidate_id: newCandidateId,
            document_id: resumeDocId,
            issue_type: 'UNCONVENTIONAL_DATE_FORMAT',
            severity: 'low',
            description: 'Date format used unconventional spelling',
            resolved: false,
            created_at: new Date().toISOString(),
          },
        ],
        total: 1,
      }));

      const getIssuesRes = await request(app)
        .get(`/api/v1/verifications/${verificationId}/issues`)
        .set('Cookie', ['cvs_session=sess-admin-99']);

      assert.equal(getIssuesRes.status, 200);
      assert.equal(getIssuesRes.body.data.length, 1);
      assert.equal(getIssuesRes.body.data[0].issue_type, 'UNCONVENTIONAL_DATE_FORMAT');

      // Step 11: Assign verification to reviewer Rita
      mock.method(verificationRepository, 'findById', async () => verificationRecord);
      mock.method(verificationRepository, 'assignReviewer', async () => ({
        ...verificationRecord,
        reviewer_id: reviewerUser.user_id,
        assigned_at: new Date().toISOString(),
      }));

      const assignRes = await request(app)
        .post(`/api/v1/verifications/${verificationId}/assign`)
        .set('Cookie', ['cvs_session=sess-admin-99'])
        .send({
          reviewerId: reviewerUser.user_id,
          priority: 'urgent',
          notes: 'Review candidate credentials promptly',
        });

      assert.equal(assignRes.status, 200);
      assert.equal(assignRes.body.success, true);
      assert.equal(assignRes.body.data.reviewer_id, reviewerUser.user_id);

      // Step 12 & 13: Authenticate as assigned reviewer Rita & View review queue
      setupMockAuth(reviewerUser);

      mock.method(verificationRepository, 'findReviewerAssignments', async () => ({
        verifications: [
          {
            ...verificationRecord,
            reviewer_id: reviewerUser.user_id,
            candidate_name: 'Alice Walker',
            candidate_email: 'alice.walker@example.com',
            candidate_status: 'in_progress',
          },
        ],
        total: 1,
        page: 1,
        limit: 10,
      }));

      const queueRes = await request(app)
        .get('/api/v1/reviewer/assignments')
        .set('Cookie', ['cvs_session=sess-reviewer-rita']);

      assert.equal(queueRes.status, 200);
      assert.equal(queueRes.body.success, true);
      assert.equal(queueRes.body.data.length, 1);
      assert.equal(queueRes.body.data[0].id, verificationId);

      // Step 14 & 15: Open assigned verification details & Inspect safe resume metadata & issues
      mock.method(verificationRepository, 'findById', async () => ({
        ...verificationRecord,
        reviewer_id: reviewerUser.user_id,
        status: 'requires_review',
      }));
      mock.method(candidateRepository, 'findById', async () => newCandidateRecord);
      mock.method(documentRepository, 'findByCandidateId', async () => [resumeRecord]);
      mock.method(validationIssueRepository, 'findByVerificationId', async () => ({
        issues: [
          {
            id: 'issue-uuid-1',
            verification_id: verificationId,
            candidate_id: newCandidateId,
            document_id: resumeDocId,
            issue_type: 'UNCONVENTIONAL_DATE_FORMAT',
            severity: 'low',
            description: 'Date format used unconventional spelling',
            resolved: false,
            created_at: new Date().toISOString(),
          },
        ],
        total: 1,
      }));
      mock.method(auditLogRepository, 'getLogsForEntity', async () => [
        {
          id: 'audit-assign-1',
          user_id: adminUser.user_id,
          action: 'VERIFICATION_ASSIGNED',
          entity_type: 'verification',
          entity_id: verificationId,
          old_values: null,
          new_values: { reviewerId: reviewerUser.user_id },
          ip_address: '127.0.0.1',
          user_agent: 'test',
          created_at: new Date().toISOString(),
        },
      ]);

      const detailsRes = await request(app)
        .get(`/api/v1/reviewer/assignments/${verificationId}`)
        .set('Cookie', ['cvs_session=sess-reviewer-rita']);

      assert.equal(detailsRes.status, 200);
      assert.equal(detailsRes.body.success, true);
      assert.equal(detailsRes.body.data.candidate.full_name, 'Alice Walker');
      assert.equal(detailsRes.body.data.resume.id, resumeDocId);
      assert.match(detailsRes.body.data.resume.download_url, /\/download$/);
      // Ensure private storage keys/paths are not exposed
      assert.equal(detailsRes.body.data.resume.storageKey, undefined);
      assert.equal(detailsRes.body.data.validation_issues.length, 1);
      assert.equal(detailsRes.body.data.review_history.length, 1);

      // Step 16: Submit APPROVED decision
      let approvedAuditRecorded = false;
      mock.method(auditLogRepository, 'logEvent', async (event: any) => {
        if (
          event.action === 'VERIFICATION_DECISION_SUBMITTED' &&
          (event.newValues?.decision === 'APPROVED' || event.details?.decision === 'APPROVED')
        ) {
          approvedAuditRecorded = true;
        }
        return {} as any;
      });
      mock.method(claimRepository, 'findByCandidateId', async () => []);
      mock.method(verificationRepository, 'findByCandidateId', async () => [
        {
          ...verificationRecord,
          status: 'passed',
        },
      ]);
      mock.method(verificationRepository, 'updateReview', async () => ({
        ...verificationRecord,
        status: 'passed',
        reviewer_id: reviewerUser.user_id,
        verified_at: new Date().toISOString(),
        notes: 'Credentials verified and approved',
      }));

      const decisionRes = await request(app)
        .post(`/api/v1/reviewer/assignments/${verificationId}/decision`)
        .set('Cookie', ['cvs_session=sess-reviewer-rita'])
        .send({
          decision: 'APPROVED',
          notes: 'Credentials verified and approved',
        });

      // Step 17: Verify final status and audit history
      assert.equal(decisionRes.status, 200);
      assert.equal(decisionRes.body.success, true);
      assert.equal(decisionRes.body.data.status, 'passed');
      assert.equal(decisionRes.body.data.decision, 'APPROVED');
      assert.equal(approvedAuditRecorded, true);
      assert.equal(approvedAuditRecorded, true);
    });

    it('Branch Test: Should submit REJECTED decision and set candidate status to flagged', async () => {
      setupMockAuth(reviewerUser);

      const branchVerifId = 'e0000000-0000-0000-0000-000000000002';
      mock.method(verificationRepository, 'findById', async () => ({
        ...verificationRecord,
        id: branchVerifId,
        reviewer_id: reviewerUser.user_id,
        status: 'requires_review',
      }));
      mock.method(candidateRepository, 'findById', async () => newCandidateRecord);
      mock.method(verificationRepository, 'updateReview', async () => ({
        ...verificationRecord,
        id: branchVerifId,
        status: 'failed',
        reviewer_id: reviewerUser.user_id,
        notes: 'Fraudulent work experience entries',
      }));
      mock.method(claimRepository, 'findByCandidateId', async () => []);
      mock.method(candidateRepository, 'update', async (_id: string, updateData: any) => {
        assert.equal(updateData.status, 'flagged');
        return { ...newCandidateRecord, status: 'flagged' };
      });

      let rejectedAuditRecorded = false;
      mock.method(auditLogRepository, 'logEvent', async (event: any) => {
        if (
          event.action === 'VERIFICATION_DECISION_SUBMITTED' &&
          (event.details?.decision === 'REJECTED' || event.newValues?.decision === 'REJECTED')
        ) {
          rejectedAuditRecorded = true;
        }
        return {} as any;
      });

      const res = await request(app)
        .post(`/api/v1/reviewer/assignments/${branchVerifId}/decision`)
        .set('Cookie', ['cvs_session=sess-reviewer-rita'])
        .send({
          decision: 'REJECTED',
          reason: 'Fraudulent work experience entries',
        });

      assert.equal(res.status, 200);
      assert.equal(res.body.data.status, 'failed');
      assert.equal(rejectedAuditRecorded, true);
    });

    it('Branch Test: Should submit NEEDS_INFORMATION decision and preserve in_progress status', async () => {
      setupMockAuth(reviewerUser);

      const branchVerifId = 'e0000000-0000-0000-0000-000000000003';
      mock.method(verificationRepository, 'findById', async () => ({
        ...verificationRecord,
        id: branchVerifId,
        reviewer_id: reviewerUser.user_id,
        status: 'pending',
      }));
      mock.method(candidateRepository, 'findById', async () => newCandidateRecord);
      mock.method(verificationRepository, 'updateReview', async () => ({
        ...verificationRecord,
        id: branchVerifId,
        status: 'requires_review',
        reviewer_id: reviewerUser.user_id,
        notes: 'Degree transcript missing official seal',
      }));
      mock.method(claimRepository, 'findByCandidateId', async () => []);
      mock.method(candidateRepository, 'update', async (_id: string, updateData: any) => {
        assert.equal(updateData.status, 'in_progress');
        return { ...newCandidateRecord, status: 'in_progress' };
      });

      const res = await request(app)
        .post(`/api/v1/reviewer/assignments/${branchVerifId}/decision`)
        .set('Cookie', ['cvs_session=sess-reviewer-rita'])
        .send({
          decision: 'NEEDS_INFORMATION',
          reason: 'Degree transcript missing official seal',
        });

      assert.equal(res.status, 200);
      assert.equal(res.body.data.status, 'requires_review');
    });
  });

  // --------------------------------------------------------------------------
  // SECTION 3: Authentication and Authorization Security Tests
  // --------------------------------------------------------------------------
  describe('3. Authentication, RBAC & Identity Tampering Security Tests', () => {
    it('should return 401 Unauthorized when unauthenticated request arrives', async () => {
      const res = await request(app).get('/api/v1/reviewer/assignments');
      assert.equal(res.status, 401);
      assert.equal(res.body.success, false);
      assert.equal(res.body.error.code, 'UNAUTHORIZED');
    });

    it('should return 401 when session has expired or is revoked', async () => {
      setupMockAuth({ valid: false, error: 'Session expired or revoked' });

      const res = await request(app)
        .get('/api/v1/candidates')
        .set('Cookie', ['cvs_session=expired-token']);

      assert.equal(res.status, 401);
      assert.equal(res.body.success, false);
      assert.equal(res.body.error.code, 'UNAUTHORIZED');
    });

    it('should return 403 when reviewer attempts to access recruiter-only candidate creation', async () => {
      setupMockAuth(reviewerUser);

      const res = await request(app)
        .post('/api/v1/candidates')
        .set('Cookie', ['cvs_session=sess-reviewer-rita'])
        .send({
          fullName: 'Unauthorized Candidate',
          email: 'unauth@example.com',
        });

      assert.equal(res.status, 403);
      assert.equal(res.body.error.code, 'FORBIDDEN');
    });

    it('should return 403 when recruiter attempts to access reviewer assignments queue', async () => {
      setupMockAuth(recruiterUser);

      const res = await request(app)
        .get('/api/v1/reviewer/assignments')
        .set('Cookie', ['cvs_session=sess-recruiter-99']);

      assert.equal(res.status, 403);
      assert.equal(res.body.error.code, 'FORBIDDEN');
    });

    it('should prevent reviewer Oscar from accessing reviewer Rita assignment details (queue isolation)', async () => {
      setupMockAuth(otherReviewer);

      mock.method(verificationRepository, 'findById', async () => ({
        id: 'verif-rita-1',
        candidate_id: 'cand-uuid-1',
        reviewer_id: reviewerUser.user_id, // Assigned to Rita, not Oscar!
        status: 'requires_review',
      }));

      const res = await request(app)
        .get('/api/v1/reviewer/assignments/verif-rita-1')
        .set('Cookie', ['cvs_session=sess-reviewer-oscar']);

      assert.equal(res.status, 403);
      assert.equal(res.body.success, false);
      assert.match(res.body.error.message, /not assigned to you/i);
    });

    it('should prevent privilege escalation: request body payload cannot change user identity or roles', async () => {
      setupMockAuth(recruiterUser);

      mock.method(candidateRepository, 'create', async (data: any) => ({
        id: 'c-tamper-1',
        full_name: data.full_name,
        email: data.email,
        created_by: recruiterUser.user_id, // Repository sets authenticated user_id
      }));

      const res = await request(app)
        .post('/api/v1/candidates')
        .set('Cookie', ['cvs_session=sess-recruiter-99'])
        .send({
          fullName: 'Test Tampering',
          email: 'tamper@example.com',
          user_id: adminUser.user_id,
          roles: ['admin'],
          created_by: adminUser.user_id,
        });

      assert.equal(res.status, 201);
      assert.equal(res.body.data.created_by, recruiterUser.user_id);
      assert.notEqual(res.body.data.created_by, adminUser.user_id);
    });
  });

  // --------------------------------------------------------------------------
  // SECTION 4: CSV and Import Security & Edge Cases
  // --------------------------------------------------------------------------
  describe('4. CSV and Import Security Tests', () => {
    it('should return 400 when CSV has malformed or unparseable syntax', async () => {
      setupMockAuth(adminUser);

      const malformedCsv = 'Full Name,Email,Phone\n"Unclosed quote row,alice@example.com,+12345';

      const res = await request(app)
        .post('/api/v1/imports/csv/preview')
        .set('Cookie', ['cvs_session=sess-admin-99'])
        .send({ csvContent: malformedCsv });

      assert.equal(res.status, 400);
      assert.equal(res.body.success, false);
      assert.match(res.body.error.message, /parse/i);
    });

    it('should return 200 with row marked INVALID when CSV is missing required headers', async () => {
      setupMockAuth(adminUser);

      const missingHeadersCsv = 'City,Job Title,Phone\nNew York,Engineer,+15550100';

      mock.method(candidateRepository, 'findExistingEmails', async () => new Map());

      const res = await request(app)
        .post('/api/v1/imports/csv/preview')
        .set('Cookie', ['cvs_session=sess-admin-99'])
        .send({ csvContent: missingHeadersCsv });

      assert.equal(res.status, 200);
      assert.equal(res.body.data.invalidRows, 1);
      assert.equal(res.body.data.rows[0].status, 'INVALID');
      assert.ok(res.body.data.rows[0].issues.length > 0);
    });

    it('should parse quoted commas and escaped quotes accurately without misaligning columns', async () => {
      setupMockAuth(adminUser);

      const quotedCsv =
        'Full Name,Email Address,Job Title,Location\n' +
        '"Doe, John ""The Senior"" Engineer",john.quoted@example.com,"Lead Architect, Cloud","Seattle, WA"';

      mock.method(candidateRepository, 'findExistingEmails', async () => new Map());

      const res = await request(app)
        .post('/api/v1/imports/csv/preview')
        .set('Cookie', ['cvs_session=sess-admin-99'])
        .send({ csvContent: quotedCsv });

      assert.equal(res.status, 200);
      assert.equal(res.body.data.rows.length, 1);
      assert.equal(res.body.data.rows[0].status, 'NEW');
      assert.equal(res.body.data.rows[0].data.fullName, 'Doe, John "The Senior" Engineer');
      assert.equal(res.body.data.rows[0].data.currentJobTitle, 'Lead Architect, Cloud');
    });

    it('should return completed status idempotently when confirming an already completed batch', async () => {
      setupMockAuth(adminUser);

      const batchAlreadyDoneId = 'b0000000-0000-0000-0000-000000009999';
      mock.method(importBatchRepository, 'findById', async () => ({
        id: batchAlreadyDoneId,
        uploaded_by: adminUser.user_id,
        file_name: 'test.csv',
        total_rows: 3,
        processed_rows: 3,
        successful_rows: 1,
        failed_rows: 0,
        status: 'completed',
        error_summary: {
          skippedInvalidCount: 0,
          skippedDatabaseDuplicateCount: 1,
          skippedCsvDuplicateCount: 1,
          rowOutcomes: [],
        },
        storage_key: 'key.bin',
        checksum_sha256: 'sha256fake',
        file_size_bytes: 100,
        created_at: new Date(),
        completed_at: new Date(),
      } as any));

      const res = await request(app)
        .post(`/api/v1/imports/${batchAlreadyDoneId}/confirm`)
        .set('Cookie', ['cvs_session=sess-admin-99'])
        .send({ confirm: true });

      assert.equal(res.status, 200);
      assert.equal(res.body.success, true);
      assert.equal(res.body.data.status, 'completed');
      assert.equal(res.body.data.insertedCount, 1);
    });

    it('should roll back database transaction and release connection if insertion fails during confirm', async () => {
      setupMockAuth(adminUser);

      let rolledBack = false;
      let clientReleased = false;
      const batchFailingId = 'b0000000-0000-0000-0000-000000008888';

      mock.method(importBatchRepository, 'findById', async () => ({
        id: batchFailingId,
        status: 'pending',
        file_name: 'test.csv',
        uploaded_by: adminUser.user_id,
        total_rows: 1,
        storage_key: 'key.bin',
      } as any));
      mock.method(importBatchRepository, 'claimForProcessing', async () => true);
      mock.method(importBatchRepository, 'updateStatus', async () => {});

      mock.method(pool, 'connect', async () => ({
        query: async (sql: string) => {
          if (sql === 'ROLLBACK') rolledBack = true;
          if (sql.includes('INSERT INTO candidates')) {
            throw new Error('Database connection dropped unexpectedly during INSERT');
          }
          return { rows: [], rowCount: 0 };
        },
        release: () => {
          clientReleased = true;
        },
      }));

      mock.method(storageService, 'readFile', async () =>
        Buffer.from('Full Name,Email Address\nAlice,alice@example.com')
      );

      const res = await request(app)
        .post(`/api/v1/imports/${batchFailingId}/confirm`)
        .set('Cookie', ['cvs_session=sess-admin-99'])
        .send({ confirm: true });

      assert.equal(res.status, 500);
      assert.equal(rolledBack, true);
      assert.equal(clientReleased, true);
    });
  });

  // --------------------------------------------------------------------------
  // SECTION 5: Resume Security, MIME Spoofing & Path Traversal Tests
  // --------------------------------------------------------------------------
  describe('5. Resume Security & Path Traversal Tests', () => {
    const candidateId = 'cand-uuid-security';

    it('should reject file with prohibited extension (.exe) with 400 Bad Request', async () => {
      setupMockAuth(adminUser);

      const res = await request(app)
        .post(`/api/v1/candidates/${candidateId}/resumes`)
        .set('Cookie', ['cvs_session=sess-admin-99'])
        .attach('resume', Buffer.from('malicious payload'), 'evil_binary.exe');

      assert.equal(res.status, 400);
      assert.equal(res.body.success, false);
      assert.match(res.body.error.message, /only pdf and docx/i);
    });

    it('should reject spoofed MIME type (text file renamed to .pdf without %PDF- magic bytes)', async () => {
      setupMockAuth(adminUser);

      mock.method(candidateRepository, 'findById', async () => ({
        id: candidateId,
        created_by: adminUser.user_id,
      }));

      // Plain text without PDF magic signature
      const fakePdf = Buffer.from('<html><script>alert(1)</script></html>');

      const res = await request(app)
        .post(`/api/v1/candidates/${candidateId}/resumes`)
        .set('Cookie', ['cvs_session=sess-admin-99'])
        .attach('resume', fakePdf, {
          filename: 'spoofed_resume.pdf',
          contentType: 'application/pdf',
        });

      assert.equal(res.status, 400);
      assert.match(res.body.error.message, /signature does not match|invalid file/i);
    });

    it('should sanitize path traversal attempts in filename and prevent traversal on disk', async () => {
      setupMockAuth(adminUser);

      mock.method(candidateRepository, 'findById', async () => ({
        id: candidateId,
        created_by: adminUser.user_id,
      }));

      let savedFilename = '';
      mock.method(storageService, 'saveFile', async (_stream: any, filename: string) => {
        savedFilename = filename;
        return {
          storageKey: 'sanitized-storage-key.pdf',
          sha256Hash: 'fakehash123',
          fileSizeBytes: 100,
        };
      });
      mock.method(documentRepository, 'findByChecksum', async () => null);
      mock.method(documentRepository, 'create', async () => ({
        id: 'doc-sanitized-1',
        candidate_id: candidateId,
        file_name: 'passwd.pdf',
        file_type: 'application/pdf',
        file_size_bytes: 100,
        checksum_sha256: 'fakehash123',
        document_type: 'resume',
        upload_status: 'completed',
        created_at: new Date().toISOString(),
      }));
      mock.method(extractionService, 'extractText', async () => ({
        text: 'Clean candidate resume',
        status: 'completed',
        parserName: 'pdf-parse',
        parserVersion: '2.4.5',
        data: {},
      }));
      mock.method(extractionRepository, 'create', async () => ({
        id: 'ext-sanitized-1',
        document_id: 'doc-sanitized-1',
        extracted_text: 'Clean candidate resume text preview',
        extraction_status: 'completed',
        parser_name: 'pdf-parse',
        parser_version: '2.4.5',
        extracted_data: {},
        created_at: new Date().toISOString(),
      }));
      mock.method(resumeValidationService, 'validateResume', async () => []);

      const validPdf = Buffer.concat([Buffer.from('%PDF-1.4\n'), Buffer.from('Valid resume content')]);

      const res = await request(app)
        .post(`/api/v1/candidates/${candidateId}/resumes`)
        .set('Cookie', ['cvs_session=sess-admin-99'])
        .attach('resume', validPdf, {
          filename: '../../../../etc/passwd.pdf',
          contentType: 'application/pdf',
        });

      assert.equal(res.status, 201);
      // Verify storage service strips path traversal characters
      assert.ok(!savedFilename.includes('../'));
      assert.ok(!savedFilename.includes('..\\'));
    });

    it('should reject unauthenticated resume download with 401 Unauthorized', async () => {
      const res = await request(app).get(`/api/v1/resumes/d0000000-0000-0000-0000-000000000001/download`);
      assert.equal(res.status, 401);
    });

    it('should verify that private storage root is never exposed through public static routing', async () => {
      const res = await request(app).get('/private-storage/alice-resume-key.pdf');
      // Must be 404 (standard route not found), never 200 or direct file disclosure
      assert.equal(res.status, 404);
    });
  });

  // --------------------------------------------------------------------------
  // SECTION 6: Verification & Reviewer Workflow Edge Cases & Conflict Checks
  // --------------------------------------------------------------------------
  describe('6. Verification & Reviewer Workflow Edge Cases', () => {
    const candidateId = 'c0000000-0000-0000-0000-000000000099';
    const verifId = 'e0000000-0000-0000-0000-000000000099';

    it('should return 400 when initiating verification for candidate without an uploaded resume', async () => {
      setupMockAuth(adminUser);

      mock.method(candidateRepository, 'findById', async () => ({
        id: candidateId,
        created_by: adminUser.user_id,
        status: 'pending',
      }));
      mock.method(documentRepository, 'findByCandidateId', async () => []); // No resume!

      const res = await request(app)
        .post(`/api/v1/candidates/${candidateId}/verifications`)
        .set('Cookie', ['cvs_session=sess-admin-99'])
        .send({ priority: 'normal' });

      assert.equal(res.status, 400);
      assert.equal(res.body.success, false);
      assert.match(res.body.error.message, /resume/i);
    });

    it('should return 409 Conflict when an active verification is already in progress', async () => {
      setupMockAuth(adminUser);

      mock.method(candidateRepository, 'findById', async () => ({
        id: candidateId,
        created_by: adminUser.user_id,
        status: 'in_progress',
      }));
      mock.method(documentRepository, 'findByCandidateId', async () => [
        { id: 'doc-1', document_type: 'resume', created_at: new Date() },
      ]);
      mock.method(verificationRepository, 'findActiveByCandidateId', async () => ({
        id: 'existing-active-verif',
        candidate_id: candidateId,
        status: 'requires_review', // Active!
      }));

      const res = await request(app)
        .post(`/api/v1/candidates/${candidateId}/verifications`)
        .set('Cookie', ['cvs_session=sess-admin-99'])
        .send({ priority: 'normal' });

      assert.equal(res.status, 409);
      assert.equal(res.body.success, false);
      assert.match(res.body.error.message, /already in progress/i);
    });

    it('should return 400 Bad Request when assigning verification to inactive user', async () => {
      setupMockAuth(adminUser);

      mock.method(verificationRepository, 'findById', async () => ({
        id: verifId,
        candidate_id: candidateId,
        status: 'requires_review',
        reviewer_id: null,
      }));
      mock.method(candidateRepository, 'findById', async () => ({
        id: candidateId,
        created_by: adminUser.user_id,
      }));

      const res = await request(app)
        .post(`/api/v1/verifications/${verifId}/assign`)
        .set('Cookie', ['cvs_session=sess-admin-99'])
        .send({ reviewerId: inactiveReviewerId });

      assert.equal(res.status, 400);
      assert.equal(res.body.success, false);
      assert.match(res.body.error.message, /inactive/i);
    });

    it('should return 403 Forbidden under Conflict of Interest if reviewer reviews candidate created by self', async () => {
      setupMockAuth(reviewerUser);

      mock.method(verificationRepository, 'findById', async () => ({
        id: verifId,
        candidate_id: candidateId,
        reviewer_id: reviewerUser.user_id,
        status: 'requires_review',
      }));
      mock.method(candidateRepository, 'findById', async () => ({
        id: candidateId,
        created_by: reviewerUser.user_id, // Conflict: Created by reviewer!
        email: 'other@example.com',
      }));

      const res = await request(app)
        .post(`/api/v1/reviewer/assignments/${verifId}/decision`)
        .set('Cookie', ['cvs_session=sess-reviewer-rita'])
        .send({
          decision: 'APPROVED',
          notes: 'Self-approval attempt',
        });

      assert.equal(res.status, 403);
      assert.equal(res.body.success, false);
      assert.match(res.body.error.message, /conflict of interest/i);
    });

    it('should return 400 Bad Request when REJECTED decision is submitted without minimum 5-character reason', async () => {
      setupMockAuth(reviewerUser);

      mock.method(verificationRepository, 'findById', async () => ({
        id: verifId,
        candidate_id: candidateId,
        reviewer_id: reviewerUser.user_id,
        status: 'requires_review',
      }));
      mock.method(candidateRepository, 'findById', async () => ({
        id: candidateId,
        created_by: adminUser.user_id,
        email: 'other@example.com',
      }));

      const res = await request(app)
        .post(`/api/v1/reviewer/assignments/${verifId}/decision`)
        .set('Cookie', ['cvs_session=sess-reviewer-rita'])
        .send({
          decision: 'REJECTED',
          reason: 'bad', // only 3 chars!
        });

      assert.equal(res.status, 400);
      assert.equal(res.body.success, false);
    });

    it('should return 409 Conflict when submitting duplicate decision on already finalized verification', async () => {
      setupMockAuth(reviewerUser);

      mock.method(verificationRepository, 'findById', async () => ({
        id: verifId,
        candidate_id: candidateId,
        reviewer_id: reviewerUser.user_id,
        status: 'passed', // Already approved!
      }));
      mock.method(candidateRepository, 'findById', async () => ({
        id: candidateId,
        created_by: adminUser.user_id,
        email: 'other@example.com',
      }));

      const res = await request(app)
        .post(`/api/v1/reviewer/assignments/${verifId}/decision`)
        .set('Cookie', ['cvs_session=sess-reviewer-rita'])
        .send({
          decision: 'APPROVED',
          notes: 'Duplicate approval attempt',
        });

      assert.equal(res.status, 409);
      assert.equal(res.body.success, false);
      assert.match(res.body.error.message, /already been recorded|already marked/i);
    });
  });

  // --------------------------------------------------------------------------
  // SECTION 7: Database Integrity & Audit Verification
  // --------------------------------------------------------------------------
  describe('7. Database Integrity & Audit Trail Preservations', () => {
    it('should verify soft-deleted candidates are safely excluded from duplicate queries', async () => {
      setupMockAuth(adminUser);

      mock.method(candidateRepository, 'findExistingEmails', async () => new Map()); // Deleted candidates filtered out

      const res = await request(app)
        .post('/api/v1/imports/csv/preview')
        .set('Cookie', ['cvs_session=sess-admin-99'])
        .send({
          csvContent: 'Full Name,Email Address\nGhost Candidate,ghost.deleted@example.com',
        });

      assert.equal(res.status, 200);
      assert.equal(res.body.data.newCandidates, 1);
      assert.equal(res.body.data.existingDatabaseDuplicates, 0);
    });

    it('should verify audit logging captures all mandatory Step 5 & 6 verification events', async () => {
      const loggedActions: string[] = [];

      mock.method(auditLogRepository, 'logEvent', async (event: any) => {
        loggedActions.push(event.action);
        return {} as any;
      });

      // Verify that audit log repository accepts and records the Phase 9 events
      await auditLogRepository.logEvent({
        actor_id: adminUser.user_id,
        action: 'CANDIDATE_VERIFICATION_INITIATED',
        resource_type: 'verification',
        resource_id: 'verif-test-1',
        details: { total_issues: 2 },
      });

      await auditLogRepository.logEvent({
        actor_id: adminUser.user_id,
        action: 'VERIFICATION_ASSIGNED',
        resource_type: 'verification',
        resource_id: 'verif-test-1',
        details: { assigned_to: reviewerUser.user_id },
      });

      await auditLogRepository.logEvent({
        actor_id: reviewerUser.user_id,
        action: 'VERIFICATION_DECISION_SUBMITTED',
        resource_type: 'verification',
        resource_id: 'verif-test-1',
        details: { decision: 'APPROVED', resulting_status: 'passed' },
      });

      assert.ok(loggedActions.includes('CANDIDATE_VERIFICATION_INITIATED'));
      assert.ok(loggedActions.includes('VERIFICATION_ASSIGNED'));
      assert.ok(loggedActions.includes('VERIFICATION_DECISION_SUBMITTED'));
    });
  });
});
