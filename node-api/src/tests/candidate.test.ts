import { describe, it, mock, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import request from 'supertest';
import { app } from '../app';
import { userRoleRepository } from '../repositories/userRole.repository';
import { candidateRepository } from '../repositories/candidate.repository';
import { documentRepository } from '../repositories/document.repository';
import { extractionRepository } from '../repositories/extraction.repository';
import { validationIssueRepository } from '../repositories/validationIssue.repository';
import { storageService } from '../services/storage.service';
import { extractionService } from '../services/extraction.service';
import { resumeValidationService } from '../services/resumeValidation.service';
import { auditLogRepository } from '../repositories/auditLog.repository';
import { CandidateRecord, DocumentRecord } from '../types/candidate.types';

describe('Phase 8: Candidate Management & Resume Upload Test Suite', () => {
  afterEach(() => {
    mock.reset();
  });

  const recruiterUser = {
    valid: true,
    user_id: 'recruiter-uuid-1111',
    email: 'recruiter@example.com',
    name: 'Rachel Recruiter',
    roles: ['recruiter'],
    session_id: 'sess-recruiter-1',
    expires_at: '2026-11-30T12:00:00Z',
  };

  const adminUser = {
    valid: true,
    user_id: 'admin-uuid-2222',
    email: 'admin@example.com',
    name: 'Adam Admin',
    roles: ['admin'],
    session_id: 'sess-admin-1',
    expires_at: '2026-11-30T12:00:00Z',
  };

  const reviewerUser = {
    valid: true,
    user_id: 'reviewer-uuid-3333',
    email: 'reviewer@example.com',
    name: 'Rita Reviewer',
    roles: ['reviewer'],
    session_id: 'sess-reviewer-1',
    expires_at: '2026-11-30T12:00:00Z',
  };

  const setupMockAuth = (userPayload: any) => {
    mock.method(globalThis, 'fetch', async () => {
      return new Response(JSON.stringify(userPayload), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      });
    });
    mock.method(userRoleRepository, 'getUserRoles', async () => userPayload.roles);
  };

  const sampleCandidate: CandidateRecord = {
    id: 'cand-uuid-1001',
    full_name: 'John Doe',
    email: 'john.doe@example.com',
    phone: '+1-555-0123',
    location: 'New York, NY',
    current_job_title: 'Full Stack Engineer',
    status: 'applied',
    created_by: 'recruiter-uuid-1111',
    created_at: new Date().toISOString(),
    updated_at: new Date().toISOString(),
    deleted_at: null,
  };

  const sampleDocument: DocumentRecord = {
    id: 'doc-uuid-2001',
    candidate_id: 'cand-uuid-1001',
    file_name: 'john_doe_resume.pdf',
    file_type: 'application/pdf',
    file_size_bytes: 1024,
    storage_key: 'random-uuid.pdf',
    checksum_sha256: 'abc123sha256fakehash',
    document_type: 'resume',
    upload_status: 'completed',
    uploaded_by: 'recruiter-uuid-1111',
    created_at: new Date().toISOString(),
    updated_at: new Date().toISOString(),
  };

  /* -------------------------------------------------------------
   * 1. CANDIDATE CRUD TESTS
   * ------------------------------------------------------------- */

  it('1. should return 401 when creating candidate without authentication', async () => {
    const res = await request(app).post('/api/v1/candidates').send({
      fullName: 'John Doe',
      email: 'john.doe@example.com',
    });

    assert.equal(res.status, 401);
    assert.equal(res.body.success, false);
    assert.equal(res.body.error.code, 'UNAUTHORIZED');
  });

  it('2. should return 403 when reviewer attempts to create a candidate', async () => {
    setupMockAuth(reviewerUser);

    const res = await request(app)
      .post('/api/v1/candidates')
      .set('Cookie', ['cvs_session=reviewer-token'])
      .send({
        fullName: 'Jane Doe',
        email: 'jane.doe@example.com',
      });

    assert.equal(res.status, 403);
    assert.equal(res.body.success, false);
    assert.equal(res.body.error.code, 'FORBIDDEN');
  });

  it('3. should return 400 when candidate payload fails validation (missing name / invalid email)', async () => {
    setupMockAuth(recruiterUser);

    const res = await request(app)
      .post('/api/v1/candidates')
      .set('Cookie', ['cvs_session=recruiter-token'])
      .send({
        fullName: '   ',
        email: 'invalid-email-format',
      });

    assert.equal(res.status, 400);
    assert.equal(res.body.success, false);
    assert.equal(res.body.error.code, 'VALIDATION_ERROR');
  });

  it('4. should return 409 when creating candidate with existing email', async () => {
    setupMockAuth(recruiterUser);

    mock.method(candidateRepository, 'findByEmail', async () => sampleCandidate);

    const res = await request(app)
      .post('/api/v1/candidates')
      .set('Cookie', ['cvs_session=recruiter-token'])
      .send({
        fullName: 'John Doe',
        email: 'john.doe@example.com',
      });

    assert.equal(res.status, 409);
    assert.equal(res.body.success, false);
    assert.equal(res.body.error.code, 'CONFLICT');
  });

  it('5. should return 201 when recruiter creates a valid candidate', async () => {
    setupMockAuth(recruiterUser);

    mock.method(candidateRepository, 'findByEmail', async () => null);
    mock.method(candidateRepository, 'create', async () => sampleCandidate);
    mock.method(auditLogRepository, 'logEvent', async () => ({} as any));

    const res = await request(app)
      .post('/api/v1/candidates')
      .set('Cookie', ['cvs_session=recruiter-token'])
      .send({
        fullName: 'John Doe',
        email: 'JOHN.DOE@EXAMPLE.COM',
        phone: '+1-555-0123',
        location: 'New York, NY',
        currentJobTitle: 'Full Stack Engineer',
      });

    assert.equal(res.status, 201);
    assert.equal(res.body.success, true);
    assert.equal(res.body.data.id, sampleCandidate.id);
    assert.equal(res.body.data.email, sampleCandidate.email);
  });

  it('6. should return 200 with paginated candidate list for recruiter', async () => {
    setupMockAuth(recruiterUser);

    mock.method(candidateRepository, 'findPaginated', async () => ({
      candidates: [sampleCandidate],
      total: 1,
      page: 1,
      limit: 20,
    }));

    const res = await request(app)
      .get('/api/v1/candidates?page=1&limit=20&search=John')
      .set('Cookie', ['cvs_session=recruiter-token']);

    assert.equal(res.status, 200);
    assert.equal(res.body.success, true);
    assert.equal(res.body.data.length, 1);
    assert.equal(res.body.pagination.total, 1);
  });

  it('7. should return 404 when getting non-existent candidate by ID', async () => {
    setupMockAuth(recruiterUser);

    mock.method(candidateRepository, 'findById', async () => null);

    const res = await request(app)
      .get('/api/v1/candidates/a0000000-0000-0000-0000-000000000000')
      .set('Cookie', ['cvs_session=recruiter-token']);

    assert.equal(res.status, 404);
    assert.equal(res.body.success, false);
    assert.equal(res.body.error.code, 'NOT_FOUND');
  });

  it('8. should return 200 when getting candidate by ID', async () => {
    setupMockAuth(recruiterUser);

    mock.method(candidateRepository, 'findById', async () => sampleCandidate);
    mock.method(documentRepository, 'findByCandidateId', async () => [sampleDocument]);

    const res = await request(app)
      .get(`/api/v1/candidates/${sampleCandidate.id}`)
      .set('Cookie', ['cvs_session=recruiter-token']);

    assert.equal(res.status, 200);
    assert.equal(res.body.success, true);
    assert.equal(res.body.data.id, sampleCandidate.id);
    assert.equal(res.body.data.documentsCount, 1);
  });

  it('9. should return 200 when updating candidate', async () => {
    setupMockAuth(recruiterUser);

    const updatedCandidate = { ...sampleCandidate, full_name: 'Johnathan Doe' };
    mock.method(candidateRepository, 'findById', async () => sampleCandidate);
    mock.method(candidateRepository, 'update', async () => updatedCandidate);
    mock.method(auditLogRepository, 'logEvent', async () => ({} as any));

    const res = await request(app)
      .patch(`/api/v1/candidates/${sampleCandidate.id}`)
      .set('Cookie', ['cvs_session=recruiter-token'])
      .send({
        fullName: 'Johnathan Doe',
      });

    assert.equal(res.status, 200);
    assert.equal(res.body.success, true);
    assert.equal(res.body.data.full_name, 'Johnathan Doe');
  });

  it('10. should return 200 when soft-deleting candidate by owning recruiter or admin', async () => {
    setupMockAuth(recruiterUser);

    mock.method(candidateRepository, 'findById', async () => sampleCandidate);
    mock.method(candidateRepository, 'softDelete', async () => true);
    mock.method(auditLogRepository, 'logEvent', async () => ({} as any));

    const res = await request(app)
      .delete(`/api/v1/candidates/${sampleCandidate.id}`)
      .set('Cookie', ['cvs_session=recruiter-token']);

    assert.equal(res.status, 200);
    assert.equal(res.body.success, true);
    assert.ok(res.body.message.includes('soft-deleted'));
  });

  /* -------------------------------------------------------------
   * 2. RESUME UPLOAD & FILE VALIDATION TESTS
   * ------------------------------------------------------------- */

  it('11. should return 400 when uploading resume without a file attached', async () => {
    setupMockAuth(recruiterUser);

    mock.method(candidateRepository, 'findById', async () => sampleCandidate);

    const res = await request(app)
      .post(`/api/v1/candidates/${sampleCandidate.id}/resumes`)
      .set('Cookie', ['cvs_session=recruiter-token']);

    assert.equal(res.status, 400);
    assert.equal(res.body.success, false);
  });

  it('12. should return 400 when file extension is unsupported (.txt)', async () => {
    setupMockAuth(recruiterUser);

    mock.method(candidateRepository, 'findById', async () => sampleCandidate);

    const res = await request(app)
      .post(`/api/v1/candidates/${sampleCandidate.id}/resumes`)
      .set('Cookie', ['cvs_session=recruiter-token'])
      .attach('resume', Buffer.from('Plain text file'), 'resume.txt');

    assert.equal(res.status, 400);
    assert.equal(res.body.success, false);
  });

  it('13. should return 400 when magic bytes do not match PDF signature', async () => {
    setupMockAuth(recruiterUser);

    mock.method(candidateRepository, 'findById', async () => sampleCandidate);

    // Fake PDF file that contains plain text without %PDF- magic bytes
    const fakePdfBuffer = Buffer.from('This is not a real PDF file content');

    const res = await request(app)
      .post(`/api/v1/candidates/${sampleCandidate.id}/resumes`)
      .set('Cookie', ['cvs_session=recruiter-token'])
      .attach('resume', fakePdfBuffer, {
        filename: 'resume.pdf',
        contentType: 'application/pdf',
      });

    assert.equal(res.status, 400);
    assert.equal(res.body.success, false);
    assert.ok(res.body.error.message.includes('signature') || res.body.error.message.includes('PDF'));
  });

  it('14. should return 201 when valid PDF with %PDF- header is uploaded, extracted and validated', async () => {
    setupMockAuth(recruiterUser);

    // Construct valid PDF magic bytes: %PDF-1.4 followed by resume body
    const validPdfBuffer = Buffer.concat([
      Buffer.from('%PDF-1.4\n%âãÏÓ\n'),
      Buffer.from('John Doe\njohn.doe@example.com\n+1-555-0123\nEducation: B.S. Computer Science\nExperience: Senior Software Engineer at Tech Corp 2020-2024\n'),
    ]);

    mock.method(candidateRepository, 'findById', async () => sampleCandidate);
    mock.method(documentRepository, 'findByChecksum', async () => null);
    mock.method(storageService, 'saveFile', async () => ({
      storageKey: 'test-uuid-stored.pdf',
      sha256Hash: 'validhash123',
      fileSizeBytes: validPdfBuffer.length,
    }));
    mock.method(documentRepository, 'create', async () => sampleDocument);
    mock.method(extractionService, 'extractText', async () => ({
      text: 'John Doe\njohn.doe@example.com\n+1-555-0123\nEducation: B.S. Computer Science\nExperience: Senior Software Engineer at Tech Corp 2020-2024',
      status: 'completed',
      parserName: 'pdf-parse',
      parserVersion: '1.1.1',
      data: { numPages: 1 },
    }));
    mock.method(extractionRepository, 'create', async () => ({
      id: 'ext-uuid-1',
      document_id: sampleDocument.id,
      extracted_text: 'sample text',
      extracted_data: {},
      extraction_status: 'completed',
      parser_name: 'pdf-parse',
      parser_version: '1.1.1',
      created_at: new Date().toISOString(),
    }));
    mock.method(resumeValidationService, 'validateResume', async () => []);
    mock.method(auditLogRepository, 'logEvent', async () => ({} as any));

    const res = await request(app)
      .post(`/api/v1/candidates/${sampleCandidate.id}/resumes`)
      .set('Cookie', ['cvs_session=recruiter-token'])
      .attach('resume', validPdfBuffer, {
        filename: 'john_doe_resume.pdf',
        contentType: 'application/pdf',
      });

    assert.equal(res.status, 201);
    assert.equal(res.body.success, true);
    assert.equal(res.body.data.document.id, sampleDocument.id);
    assert.equal(res.body.data.extraction.status, 'completed');
  });

  it('15. should return 201 when valid DOCX with PK signature is uploaded', async () => {
    setupMockAuth(recruiterUser);

    // Construct valid DOCX / ZIP magic bytes: PK\x03\x04
    const validDocxBuffer = Buffer.concat([
      Buffer.from([0x50, 0x4b, 0x03, 0x04, 0x14, 0x00, 0x06, 0x00]),
      Buffer.from('Docx zip stream data with John Doe education and experience'),
    ]);

    mock.method(candidateRepository, 'findById', async () => sampleCandidate);
    mock.method(documentRepository, 'findByChecksum', async () => null);
    mock.method(storageService, 'saveFile', async () => ({
      storageKey: 'test-uuid-stored.docx',
      sha256Hash: 'docxfakehash123',
      fileSizeBytes: validDocxBuffer.length,
    }));
    mock.method(documentRepository, 'create', async () => ({
      ...sampleDocument,
      file_name: 'john_doe.docx',
      file_type: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    }));
    mock.method(extractionService, 'extractText', async () => ({
      text: 'John Doe resume text',
      status: 'completed',
      parserName: 'mammoth',
      parserVersion: '1.8.0',
      data: {},
    }));
    mock.method(extractionRepository, 'create', async () => ({
      id: 'ext-uuid-2',
      document_id: sampleDocument.id,
      extracted_text: 'sample text',
      extracted_data: {},
      extraction_status: 'completed',
      parser_name: 'mammoth',
      parser_version: '1.8.0',
      created_at: new Date().toISOString(),
    }));
    mock.method(resumeValidationService, 'validateResume', async () => []);
    mock.method(auditLogRepository, 'logEvent', async () => ({} as any));

    const res = await request(app)
      .post(`/api/v1/candidates/${sampleCandidate.id}/resumes`)
      .set('Cookie', ['cvs_session=recruiter-token'])
      .attach('resume', validDocxBuffer, {
        filename: 'john_doe.docx',
        contentType: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
      });

    assert.equal(res.status, 201);
    assert.equal(res.body.success, true);
  });

  it('16. should return 409 when duplicate document checksum is uploaded', async () => {
    setupMockAuth(recruiterUser);

    const validPdfBuffer = Buffer.concat([
      Buffer.from('%PDF-1.4\n'),
      Buffer.from('Duplicate PDF content'),
    ]);

    mock.method(candidateRepository, 'findById', async () => sampleCandidate);
    // Return existing document with identical checksum
    mock.method(documentRepository, 'findByChecksum', async () => sampleDocument);

    const res = await request(app)
      .post(`/api/v1/candidates/${sampleCandidate.id}/resumes`)
      .set('Cookie', ['cvs_session=recruiter-token'])
      .attach('resume', validPdfBuffer, {
        filename: 'resume.pdf',
        contentType: 'application/pdf',
      });

    assert.equal(res.status, 409);
    assert.equal(res.body.success, false);
    assert.equal(res.body.error.code, 'CONFLICT');
  });

  /* -------------------------------------------------------------
   * 3. RESUME DETAILS & DOWNLOAD TESTS
   * ------------------------------------------------------------- */

  it('17. should return 200 with resume details, extraction and validation issues', async () => {
    setupMockAuth(recruiterUser);

    mock.method(documentRepository, 'findById', async () => sampleDocument);
    mock.method(candidateRepository, 'findById', async () => sampleCandidate);
    mock.method(extractionRepository, 'findByDocumentId', async () => ({
      id: 'ext-1',
      document_id: sampleDocument.id,
      extracted_text: 'Sample extracted resume text',
      extracted_data: {},
      extraction_status: 'completed',
      parser_name: 'pdf-parse',
      parser_version: '1.1.1',
      created_at: new Date().toISOString(),
    }));
    mock.method(validationIssueRepository, 'findByDocumentId', async () => [
      {
        id: 'iss-1',
        candidate_id: sampleCandidate.id,
        document_id: sampleDocument.id,
        severity: 'low',
        issue_type: 'PHONE_NOT_DETECTED',
        description: 'Phone not detected in text',
        status: 'open',
        created_at: new Date().toISOString(),
      },
    ]);

    const res = await request(app)
      .get(`/api/v1/resumes/${sampleDocument.id}`)
      .set('Cookie', ['cvs_session=recruiter-token']);

    assert.equal(res.status, 200);
    assert.equal(res.body.success, true);
    assert.equal(res.body.data.document.id, sampleDocument.id);
    assert.equal(res.body.data.validationIssues.length, 1);
  });

  it('18. should return 200 file stream when downloading resume', async () => {
    setupMockAuth(recruiterUser);

    const streamContent = Buffer.from('%PDF-1.4 file content stream');
    mock.method(documentRepository, 'findById', async () => ({
      ...sampleDocument,
      file_size_bytes: streamContent.length,
    }));
    mock.method(candidateRepository, 'findById', async () => sampleCandidate);
    mock.method(auditLogRepository, 'logEvent', async () => ({} as any));

    const { Readable } = await import('stream');
    const fakeStream = Readable.from([streamContent]);
    mock.method(storageService, 'createReadStream', () => fakeStream as any);

    const res = await request(app)
      .get(`/api/v1/resumes/${sampleDocument.id}/download`)
      .set('Cookie', ['cvs_session=recruiter-token']);

    assert.equal(res.status, 200);
    assert.equal(res.headers['content-type'], 'application/pdf');
    assert.ok(res.headers['content-disposition'].includes('attachment'));
    assert.ok(res.headers['content-disposition'].includes('john_doe_resume.pdf'));
  });

  /* -------------------------------------------------------------
   * 4. RULE-BASED RESUME VALIDATION CHECKS
   * ------------------------------------------------------------- */

  it('19. should detect EMPTY_OR_UNREADABLE_DOCUMENT when resume text is too short', async () => {
    const issuesCreated: any[] = [];
    mock.method(validationIssueRepository, 'create', async (data: any) => {
      issuesCreated.push(data);
      return {
        id: 'iss-test',
        ...data,
        issue_type: data.issueType,
        status: 'open',
        created_at: new Date().toISOString(),
      };
    });

    const issues = await resumeValidationService.validateResume(
      sampleCandidate,
      'doc-123',
      'Short text'
    );

    assert.equal(issues.length, 1);
    assert.equal(issues[0].issue_type, 'EMPTY_OR_UNREADABLE_DOCUMENT');
  });

  it('20. should detect NAME_NOT_FOUND and EMAIL_MISMATCH when text does not match candidate', async () => {
    const issuesCreated: any[] = [];
    mock.method(validationIssueRepository, 'create', async (data: any) => {
      issuesCreated.push(data);
      return {
        id: 'iss-test',
        ...data,
        issue_type: data.issueType,
        status: 'open',
        created_at: new Date().toISOString(),
      };
    });

    // Provide 60+ chars so it passes empty check, but with completely different name/email
    const mismatchedText =
      'Alice Wonderland is a professional software engineer with deep experience. ' +
      'Email: alice.wonderland@otherdomain.com. Education: BS Degree. Experience: 2020-2024.';

    const issues = await resumeValidationService.validateResume(
      sampleCandidate,
      'doc-123',
      mismatchedText
    );

    const types = issues.map((i) => i.issue_type);
    assert.ok(types.includes('NAME_NOT_FOUND'));
    assert.ok(types.includes('EMAIL_MISMATCH'));
  });

  it('21. should detect INVALID_DATE_RANGE when start year is greater than end year', async () => {
    const issuesCreated: any[] = [];
    mock.method(validationIssueRepository, 'create', async (data: any) => {
      issuesCreated.push(data);
      return {
        id: 'iss-test',
        ...data,
        issue_type: data.issueType,
        status: 'open',
        created_at: new Date().toISOString(),
      };
    });

    const invertedDateText =
      'John Doe john.doe@example.com +1-555-0123 ' +
      'Education: BS Computer Science. Experience: Senior Engineer at Acme 2024 - 2020.';

    const issues = await resumeValidationService.validateResume(
      sampleCandidate,
      'doc-123',
      invertedDateText
    );

    const types = issues.map((i) => i.issue_type);
    assert.ok(types.includes('INVALID_DATE_RANGE'));
  });
});
