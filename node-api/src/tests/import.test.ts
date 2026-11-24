import { describe, it, mock, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import request from 'supertest';
import { app } from '../app';
import { pool } from '../config/database';
import { userRoleRepository } from '../repositories/userRole.repository';
import { importBatchRepository } from '../repositories/importBatch.repository';
import { candidateRepository } from '../repositories/candidate.repository';
import { storageService } from '../services/storage.service';
import { auditLogRepository } from '../repositories/auditLog.repository';
import { ImportBatchRecord } from '../types/import.types';

describe('Phase 9: Bulk CSV Ingestion Test Suite', () => {
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

  const otherRecruiter = {
    valid: true,
    user_id: 'recruiter-uuid-9999',
    email: 'other.recruiter@example.com',
    name: 'Other Recruiter',
    roles: ['recruiter'],
    session_id: 'sess-other-1',
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

  const adminUser = {
    valid: true,
    user_id: 'admin-uuid-0001',
    email: 'admin@example.com',
    name: 'Adam Admin',
    roles: ['admin'],
    session_id: 'sess-admin-1',
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

  const sampleBatch: ImportBatchRecord = {
    id: 'b0000000-0000-0000-0000-000000001001',
    uploaded_by: 'recruiter-uuid-1111',
    file_name: 'candidates_batch.csv',
    total_rows: 3,
    processed_rows: 0,
    successful_rows: 0,
    failed_rows: 0,
    status: 'pending',
    error_summary: {},
    storage_key: 'csv-storage-uuid.bin',
    checksum_sha256: 'csvfakehash123',
    file_size_bytes: 256,
    created_at: new Date(),
    completed_at: null,
  };

  it('1. should return 401 when uploading CSV without authentication', async () => {
    const res = await request(app).post('/api/v1/imports/upload');
    assert.equal(res.status, 401);
    assert.equal(res.body.success, false);
    assert.equal(res.body.error.code, 'UNAUTHORIZED');
  });

  it('2. should return 403 when reviewer role attempts to upload CSV', async () => {
    setupMockAuth(reviewerUser);

    const res = await request(app)
      .post('/api/v1/imports/upload')
      .set('Cookie', ['cvs_session=reviewer-token'])
      .attach('file', Buffer.from('full_name,email\nJohn Doe,john@example.com'), 'candidates.csv');

    assert.equal(res.status, 403);
    assert.equal(res.body.success, false);
    assert.equal(res.body.error.code, 'FORBIDDEN');
  });

  it('3. should return 400 when uploading without a CSV file', async () => {
    setupMockAuth(recruiterUser);

    const res = await request(app)
      .post('/api/v1/imports/upload')
      .set('Cookie', ['cvs_session=recruiter-token']);

    assert.equal(res.status, 400);
    assert.equal(res.body.success, false);
  });

  it('4. should return 201 with header mapping and row preview on valid CSV upload', async () => {
    setupMockAuth(recruiterUser);

    const csvContent =
      'Full Name,Email Address,Phone Number,City,Job Title\n' +
      'Alice Walker,alice.walker@example.com,+1-555-0101,Seattle,Data Scientist\n' +
      'Bob Smith,bob.smith@example.com,+1-555-0102,Austin,DevOps Lead\n';

    mock.method(storageService, 'saveFile', async () => ({
      storageKey: 'csv-storage-uuid.bin',
      sha256Hash: 'hashcsv123',
      fileSizeBytes: csvContent.length,
    }));
    mock.method(importBatchRepository, 'create', async () => sampleBatch);
    mock.method(auditLogRepository, 'logEvent', async () => ({} as any));

    const res = await request(app)
      .post('/api/v1/imports/upload')
      .set('Cookie', ['cvs_session=recruiter-token'])
      .attach('file', Buffer.from(csvContent), 'candidates.csv');

    assert.equal(res.status, 201);
    assert.equal(res.body.success, true);
    assert.equal(res.body.data.batchId, sampleBatch.id);
    assert.equal(res.body.data.totalRows, 2);
    assert.equal(res.body.data.sampleRows.length, 2);
    assert.equal(res.body.data.sampleRows[0].full_name, 'Alice Walker');
    assert.equal(res.body.data.sampleRows[0].email, 'alice.walker@example.com');
  });

  it('5. should return 404 when executing non-existent batch', async () => {
    setupMockAuth(recruiterUser);

    mock.method(importBatchRepository, 'findById', async () => null);

    const res = await request(app)
      .post('/api/v1/imports/b0000000-0000-0000-0000-000000000000/execute')
      .set('Cookie', ['cvs_session=recruiter-token']);

    assert.equal(res.status, 404);
    assert.equal(res.body.success, false);
  });

  it('6. should return 403 when recruiter executes batch uploaded by another recruiter', async () => {
    setupMockAuth(otherRecruiter);

    mock.method(importBatchRepository, 'findById', async () => sampleBatch);

    const res = await request(app)
      .post(`/api/v1/imports/${sampleBatch.id}/execute`)
      .set('Cookie', ['cvs_session=other-recruiter-token']);

    assert.equal(res.status, 403);
    assert.equal(res.body.success, false);
    assert.equal(res.body.error.code, 'FORBIDDEN');
  });

  it('7. should execute batch, insert valid rows, and record duplicate/validation errors in error_summary', async () => {
    setupMockAuth(recruiterUser);

    const csvContent =
      'full_name,email,phone,location,current_job_title\n' +
      'Valid Candidate 1,valid1@example.com,+1-555-0111,Boston,Architect\n' +
      'Duplicate In Batch,valid1@example.com,+1-555-0112,Boston,Engineer\n' +
      'Existing In DB,existing.in.db@example.com,+1-555-0113,Dallas,Developer\n' +
      'Missing Name,,+1-555-0114,Chicago,Analyst\n' +
      'Valid Candidate 2,valid2@example.com,+1-555-0115,Miami,Product Manager\n';

    mock.method(importBatchRepository, 'findById', async () => sampleBatch);
    mock.method(importBatchRepository, 'updateStatus', async () => {});
    mock.method(importBatchRepository, 'updateProgress', async () => {});
    mock.method(storageService, 'readFile', async () => Buffer.from(csvContent));

    // Existing in DB mock
    mock.method(candidateRepository, 'findByEmail', async (email: string) => {
      if (email === 'existing.in.db@example.com') {
        return { id: 'cand-exist', email: 'existing.in.db@example.com' } as any;
      }
      return null;
    });

    const createdCandidates: any[] = [];
    mock.method(candidateRepository, 'create', async (data: any, createdBy?: string, batchId?: string) => {
      createdCandidates.push({ ...data, createdBy, batchId });
      return { id: `cand-${createdCandidates.length}`, ...data };
    });
    mock.method(auditLogRepository, 'logEvent', async () => ({} as any));

    const res = await request(app)
      .post(`/api/v1/imports/${sampleBatch.id}/execute`)
      .set('Cookie', ['cvs_session=recruiter-token']);

    assert.equal(res.status, 200);
    assert.equal(res.body.success, true);
    assert.equal(res.body.data.batchId, sampleBatch.id);
    assert.equal(res.body.data.status, 'completed');
    assert.equal(res.body.data.totalRows, 5);
    assert.equal(res.body.data.successfulRows, 2);
    assert.equal(res.body.data.failedRows, 3);
    assert.equal(res.body.data.errors.length, 3);

    // Verify error reasons
    const errorMessages = res.body.data.errors.map((e: any) => e.errors.join(' '));
    assert.ok(errorMessages.some((m: string) => m.includes('Duplicate email')));
    assert.ok(errorMessages.some((m: string) => m.includes('already exists in database')));
    assert.ok(errorMessages.some((m: string) => m.toLowerCase().includes('name') || m.toLowerCase().includes('email')));

    // Verify created candidates linked to batch
    assert.equal(createdCandidates.length, 2);
    assert.equal(createdCandidates[0].batchId, sampleBatch.id);
  });

  it('8. should return 200 with batch details', async () => {
    setupMockAuth(recruiterUser);

    mock.method(importBatchRepository, 'findById', async () => sampleBatch);

    const res = await request(app)
      .get(`/api/v1/imports/${sampleBatch.id}`)
      .set('Cookie', ['cvs_session=recruiter-token']);

    assert.equal(res.status, 200);
    assert.equal(res.body.success, true);
    assert.equal(res.body.data.id, sampleBatch.id);
  });

  it('9. should return 200 with paginated batch list', async () => {
    setupMockAuth(recruiterUser);

    mock.method(importBatchRepository, 'findPaginated', async () => ({
      batches: [sampleBatch],
      total: 1,
      page: 1,
      limit: 20,
    }));

    const res = await request(app)
      .get('/api/v1/imports?page=1&limit=20')
      .set('Cookie', ['cvs_session=recruiter-token']);

    assert.equal(res.status, 200);
    assert.equal(res.body.success, true);
    assert.equal(res.body.data.length, 1);
    assert.equal(res.body.pagination.total, 1);
  });

  /* -------------------------------------------------------------------------- */
  /* Phase 9 Step 3: CSV Preview & Database Duplicate Detection Tests            */
  /* -------------------------------------------------------------------------- */

  it('10. should return 401 when previewing CSV without authentication', async () => {
    const res = await request(app).post('/api/v1/imports/csv/preview');
    assert.equal(res.status, 401);
    assert.equal(res.body.success, false);
    assert.equal(res.body.error.code, 'UNAUTHORIZED');
  });

  it('11. should return 403 when reviewer role attempts to preview CSV', async () => {
    setupMockAuth(reviewerUser);

    const res = await request(app)
      .post('/api/v1/imports/csv/preview')
      .set('Cookie', ['cvs_session=reviewer-token'])
      .attach('file', Buffer.from('full_name,email\nJohn Doe,john@example.com'), 'candidates.csv');

    assert.equal(res.status, 403);
    assert.equal(res.body.success, false);
    assert.equal(res.body.error.code, 'FORBIDDEN');
  });

  it('12. should return 400 when preview is called without CSV file or batchId', async () => {
    setupMockAuth(recruiterUser);

    const res = await request(app)
      .post('/api/v1/imports/csv/preview')
      .set('Cookie', ['cvs_session=recruiter-token']);

    assert.equal(res.status, 400);
    assert.equal(res.body.success, false);
  });

  it('13. should preview all-new candidate rows with status NEW and 0 duplicates', async () => {
    setupMockAuth(recruiterUser);

    const csvContent =
      'full_name,email,phone,location,current_job_title\n' +
      'Alice Walker,alice.new@example.com,+1-555-0101,Seattle,Data Scientist\n' +
      'Bob Builder,bob.new@example.com,+1-555-0102,Denver,Software Engineer\n';

    mock.method(candidateRepository, 'findExistingEmails', async () => new Map());

    const res = await request(app)
      .post('/api/v1/imports/csv/preview')
      .set('Cookie', ['cvs_session=recruiter-token'])
      .attach('file', Buffer.from(csvContent), 'new_candidates.csv');

    assert.equal(res.status, 200);
    assert.equal(res.body.success, true);
    assert.equal(res.body.data.totalRows, 2);
    assert.equal(res.body.data.validRows, 2);
    assert.equal(res.body.data.invalidRows, 0);
    assert.equal(res.body.data.newCandidates, 2);
    assert.equal(res.body.data.existingDatabaseDuplicates, 0);
    assert.equal(res.body.data.duplicateRowsWithinCsv, 0);
    assert.equal(res.body.data.skippedRows, 0);

    assert.equal(res.body.data.rows.length, 2);
    assert.equal(res.body.data.rows[0].status, 'NEW');
    assert.equal(res.body.data.rows[0].data.email, 'alice.new@example.com');
    assert.equal(res.body.data.rows[1].status, 'NEW');
    assert.equal(res.body.data.rows[1].data.email, 'bob.new@example.com');
  });

  it('14. should detect existing database duplicates case-insensitively with status DUPLICATE_IN_DATABASE', async () => {
    setupMockAuth(recruiterUser);

    const csvContent =
      'full_name,email,phone\n' +
      'Existing Candidate,JOHN.DOE@EXAMPLE.COM,+1-555-0103\n';

    const dbMap = new Map([
      ['john.doe@example.com', { id: 'db-cand-1234', email: 'john.doe@example.com', status: 'verified' }],
    ]);
    mock.method(candidateRepository, 'findExistingEmails', async () => dbMap);

    const res = await request(app)
      .post('/api/v1/imports/csv/preview')
      .set('Cookie', ['cvs_session=recruiter-token'])
      .attach('file', Buffer.from(csvContent), 'candidates.csv');

    assert.equal(res.status, 200);
    assert.equal(res.body.success, true);
    assert.equal(res.body.data.totalRows, 1);
    assert.equal(res.body.data.newCandidates, 0);
    assert.equal(res.body.data.existingDatabaseDuplicates, 1);
    assert.equal(res.body.data.skippedRows, 1);

    const row = res.body.data.rows[0];
    assert.equal(row.status, 'DUPLICATE_IN_DATABASE');
    assert.equal(row.duplicateInfo.candidateId, 'db-cand-1234');
    assert.equal(row.duplicateInfo.existingStatus, 'verified');
    assert.ok(row.issues[0].includes('already exists in database'));
  });

  it('15. should detect duplicate emails within the CSV with status DUPLICATE_IN_CSV', async () => {
    setupMockAuth(recruiterUser);

    const csvContent =
      'full_name,email\n' +
      'First Entry,duplicate.test@example.com\n' +
      'Second Entry,duplicate.test@example.com\n';

    mock.method(candidateRepository, 'findExistingEmails', async () => new Map());

    const res = await request(app)
      .post('/api/v1/imports/csv/preview')
      .set('Cookie', ['cvs_session=recruiter-token'])
      .attach('file', Buffer.from(csvContent), 'candidates.csv');

    assert.equal(res.status, 200);
    assert.equal(res.body.success, true);
    assert.equal(res.body.data.totalRows, 2);
    assert.equal(res.body.data.newCandidates, 1);
    assert.equal(res.body.data.duplicateRowsWithinCsv, 1);
    assert.equal(res.body.data.skippedRows, 1);

    assert.equal(res.body.data.rows[0].status, 'NEW');
    assert.equal(res.body.data.rows[1].status, 'DUPLICATE_IN_CSV');
    assert.equal(res.body.data.rows[1].duplicateInfo.firstSeenRow, 2);
    assert.ok(res.body.data.rows[1].issues[0].includes('encountered within CSV'));
  });

  it('16. should mark malformed/invalid rows as INVALID with specific validation issues', async () => {
    setupMockAuth(recruiterUser);

    const csvContent =
      'full_name,email,phone\n' +
      ',missing.name@example.com,+1-555-0104\n' +
      'Invalid Email,not-an-email-address,+1-555-0105\n';

    mock.method(candidateRepository, 'findExistingEmails', async () => new Map());

    const res = await request(app)
      .post('/api/v1/imports/csv/preview')
      .set('Cookie', ['cvs_session=recruiter-token'])
      .attach('file', Buffer.from(csvContent), 'candidates.csv');

    assert.equal(res.status, 200);
    assert.equal(res.body.success, true);
    assert.equal(res.body.data.totalRows, 2);
    assert.equal(res.body.data.validRows, 0);
    assert.equal(res.body.data.invalidRows, 2);
    assert.equal(res.body.data.skippedRows, 2);

    assert.equal(res.body.data.rows[0].status, 'INVALID');
    assert.ok(res.body.data.rows[0].issues.length > 0);
    assert.equal(res.body.data.rows[1].status, 'INVALID');
    assert.ok(res.body.data.rows[1].issues[0].includes('Invalid email'));
  });

  it('17. should correctly classify mixed rows (NEW, INVALID, DUPLICATE_IN_DATABASE, DUPLICATE_IN_CSV)', async () => {
    setupMockAuth(recruiterUser);

    const csvContent =
      'full_name,email,phone,location,current_job_title\n' +
      'Row Two Brand New,brand.new@example.com,+1-555-0201,Boston,Architect\n' +
      'Row Three DB Dup,existing.indb@example.com,+1-555-0202,Austin,DevOps\n' +
      'Row Four Invalid,invalid-email-format,+1-555-0203,Chicago,Manager\n' +
      'Row Five First Seen,shared.batch@example.com,+1-555-0204,Dallas,Analyst\n' +
      'Row Six CSV Dup,shared.batch@example.com,+1-555-0205,Seattle,Lead\n';

    const dbMap = new Map([
      ['existing.indb@example.com', { id: 'db-uuid-8888', email: 'existing.indb@example.com', status: 'pending' }],
    ]);
    mock.method(candidateRepository, 'findExistingEmails', async () => dbMap);

    const res = await request(app)
      .post('/api/v1/imports/csv/preview')
      .set('Cookie', ['cvs_session=recruiter-token'])
      .attach('file', Buffer.from(csvContent), 'candidates.csv');

    assert.equal(res.status, 200);
    assert.equal(res.body.success, true);
    assert.equal(res.body.data.totalRows, 5);
    assert.equal(res.body.data.validRows, 4);
    assert.equal(res.body.data.invalidRows, 1);
    assert.equal(res.body.data.newCandidates, 2); // Row 2 and Row 5
    assert.equal(res.body.data.existingDatabaseDuplicates, 1); // Row 3
    assert.equal(res.body.data.duplicateRowsWithinCsv, 1); // Row 6
    assert.equal(res.body.data.skippedRows, 3); // 1 invalid + 1 db dup + 1 csv dup

    // Verify row statuses in exact sequence
    assert.equal(res.body.data.rows[0].status, 'NEW');
    assert.equal(res.body.data.rows[1].status, 'DUPLICATE_IN_DATABASE');
    assert.equal(res.body.data.rows[2].status, 'INVALID');
    assert.equal(res.body.data.rows[3].status, 'NEW');
    assert.equal(res.body.data.rows[4].status, 'DUPLICATE_IN_CSV');
  });

  it('18. should exclude soft-deleted candidates from duplicate detection (marked as NEW)', async () => {
    setupMockAuth(recruiterUser);

    const csvContent =
      'full_name,email\n' +
      'Reapplied Candidate,soft.deleted@example.com\n';

    // Soft-deleted candidates are filtered out by `deleted_at IS NULL`, so findExistingEmails returns empty
    mock.method(candidateRepository, 'findExistingEmails', async () => new Map());

    const res = await request(app)
      .post('/api/v1/imports/csv/preview')
      .set('Cookie', ['cvs_session=recruiter-token'])
      .attach('file', Buffer.from(csvContent), 'candidates.csv');

    assert.equal(res.status, 200);
    assert.equal(res.body.success, true);
    assert.equal(res.body.data.newCandidates, 1);
    assert.equal(res.body.data.existingDatabaseDuplicates, 0);
    assert.equal(res.body.data.rows[0].status, 'NEW');
  });

  it('19. should preview CSV using an existing batchId reference', async () => {
    setupMockAuth(recruiterUser);

    const csvContent =
      'full_name,email\n' +
      'Batch User One,batch.user1@example.com\n' +
      'Batch User Two,batch.user2@example.com\n';

    mock.method(importBatchRepository, 'findById', async () => sampleBatch);
    mock.method(storageService, 'readFile', async () => Buffer.from(csvContent));
    mock.method(candidateRepository, 'findExistingEmails', async () => new Map());

    const res = await request(app)
      .post('/api/v1/imports/csv/preview')
      .set('Cookie', ['cvs_session=recruiter-token'])
      .send({ batchId: sampleBatch.id });

    assert.equal(res.status, 200);
    assert.equal(res.body.success, true);
    assert.equal(res.body.data.totalRows, 2);
    assert.equal(res.body.data.newCandidates, 2);
    assert.equal(res.body.data.rows[0].data.email, 'batch.user1@example.com');
  });

  /* -------------------------------------------------------------------------- */
  /* Phase 9 Step 4: Confirm & Import Candidates Tests                          */
  /* -------------------------------------------------------------------------- */

  const createMockDbClient = (queriesHandler?: (sql: string, params?: any[]) => any) => {
    return {
      query: async (sql: string, params?: any[]) => {
        if (queriesHandler) {
          const res = queriesHandler(sql, params);
          if (res !== undefined) return res;
        }
        if (sql.startsWith('BEGIN') || sql.startsWith('COMMIT') || sql.startsWith('ROLLBACK')) {
          return { rows: [], rowCount: 0 };
        }
        if (sql.includes('SELECT id, email FROM candidates')) {
          return { rows: [], rowCount: 0 };
        }
        if (sql.includes('INSERT INTO candidates')) {
          return { rows: [{ id: 'cand-confirmed-101' }], rowCount: 1 };
        }
        if (sql.includes('UPDATE import_batches')) {
          return { rows: [{ completed_at: new Date() }], rowCount: 1 };
        }
        return { rows: [], rowCount: 0 };
      },
      release: () => {},
    };
  };

  it('20. should return 401 when confirming import without authentication', async () => {
    const res = await request(app)
      .post(`/api/v1/imports/${sampleBatch.id}/confirm`)
      .send({ confirm: true });

    assert.equal(res.status, 401);
    assert.equal(res.body.success, false);
    assert.equal(res.body.error.code, 'UNAUTHORIZED');
  });

  it('21. should return 403 when reviewer role attempts to confirm import', async () => {
    setupMockAuth(reviewerUser);

    const res = await request(app)
      .post(`/api/v1/imports/${sampleBatch.id}/confirm`)
      .set('Cookie', ['cvs_session=reviewer-token'])
      .send({ confirm: true });

    assert.equal(res.status, 403);
    assert.equal(res.body.success, false);
    assert.equal(res.body.error.code, 'FORBIDDEN');
  });

  it('22. should return 400 when confirm flag is missing or false', async () => {
    setupMockAuth(recruiterUser);

    const res = await request(app)
      .post(`/api/v1/imports/${sampleBatch.id}/confirm`)
      .set('Cookie', ['cvs_session=recruiter-token'])
      .send({ confirm: false });

    assert.equal(res.status, 400);
    assert.equal(res.body.success, false);
  });

  it('23. should return 403 when recruiter attempts to confirm batch uploaded by another recruiter', async () => {
    setupMockAuth(otherRecruiter);

    mock.method(importBatchRepository, 'findById', async () => sampleBatch);

    const res = await request(app)
      .post(`/api/v1/imports/${sampleBatch.id}/confirm`)
      .set('Cookie', ['cvs_session=other-recruiter-token'])
      .send({ confirm: true });

    assert.equal(res.status, 403);
    assert.equal(res.body.success, false);
    assert.equal(res.body.error.code, 'FORBIDDEN');
  });

  it('24. should confirm import of new candidates inside transaction and return outcome summary', async () => {
    setupMockAuth(recruiterUser);

    const csvContent =
      'full_name,email,phone,location,current_job_title\n' +
      'Grace Hopper,grace@navy.mil,+1-555-0301,Arlington,Admiral\n' +
      'Alan Turing,alan@bletchley.uk,+1-555-0302,London,Cryptanalyst\n';

    mock.method(importBatchRepository, 'findById', async () => sampleBatch);
    mock.method(storageService, 'readFile', async () => Buffer.from(csvContent));
    mock.method(importBatchRepository, 'claimForProcessing', async () => true);

    const insertedRows: any[] = [];
    mock.method(pool, 'connect', async () =>
      createMockDbClient((sql, params) => {
        if (sql.includes('INSERT INTO candidates')) {
          insertedRows.push(params);
          return { rows: [{ id: `cand-new-${insertedRows.length}` }], rowCount: 1 };
        }
        return undefined;
      })
    );
    mock.method(auditLogRepository, 'logEvent', async () => ({} as any));

    const res = await request(app)
      .post(`/api/v1/imports/${sampleBatch.id}/confirm`)
      .set('Cookie', ['cvs_session=recruiter-token'])
      .send({ confirm: true });

    assert.equal(res.status, 200);
    assert.equal(res.body.success, true);
    assert.equal(res.body.data.importId, sampleBatch.id);
    assert.equal(res.body.data.status, 'completed');
    assert.equal(res.body.data.totalRows, 2);
    assert.equal(res.body.data.insertedCount, 2);
    assert.equal(res.body.data.skippedInvalidCount, 0);
    assert.equal(res.body.data.skippedDatabaseDuplicateCount, 0);
    assert.equal(res.body.data.skippedCsvDuplicateCount, 0);
    assert.equal(res.body.data.failedCount, 0);
    assert.equal(res.body.data.rowOutcomes.length, 2);
    assert.equal(res.body.data.rowOutcomes[0].status, 'INSERTED');
    assert.equal(res.body.data.rowOutcomes[1].status, 'INSERTED');

    // Verify 2 candidates inserted with correct normalization
    assert.equal(insertedRows.length, 2);
    assert.equal(insertedRows[0][3], 'grace@navy.mil');
    assert.equal(insertedRows[1][3], 'alan@bletchley.uk');
  });

  it('25. should skip invalid rows, database duplicates, and CSV duplicates during confirmation', async () => {
    setupMockAuth(recruiterUser);

    const csvContent =
      'full_name,email,phone,location,current_job_title\n' +
      'Valid Cand,valid.unique@example.com,+1-555-0401,Austin,Dev\n' +
      'Missing Name,,+1-555-0402,Austin,Dev\n' +
      'Existing DB Dup,existing.in.db@example.com,+1-555-0403,Austin,Dev\n' +
      'Valid Cand Again,valid.unique@example.com,+1-555-0404,Austin,Dev\n';

    mock.method(importBatchRepository, 'findById', async () => sampleBatch);
    mock.method(storageService, 'readFile', async () => Buffer.from(csvContent));
    mock.method(importBatchRepository, 'claimForProcessing', async () => true);

    const insertedRows: any[] = [];
    mock.method(pool, 'connect', async () =>
      createMockDbClient((sql, params) => {
        if (sql.includes('SELECT id, email FROM candidates')) {
          if (params?.[0] === 'existing.in.db@example.com') {
            return { rows: [{ id: 'cand-existing-in-db', email: 'existing.in.db@example.com' }], rowCount: 1 };
          }
          return { rows: [], rowCount: 0 };
        }
        if (sql.includes('INSERT INTO candidates')) {
          insertedRows.push(params);
          return { rows: [{ id: 'cand-unique-id' }], rowCount: 1 };
        }
        return undefined;
      })
    );
    mock.method(auditLogRepository, 'logEvent', async () => ({} as any));

    const res = await request(app)
      .post(`/api/v1/imports/${sampleBatch.id}/confirm`)
      .set('Cookie', ['cvs_session=recruiter-token'])
      .send({ confirm: true });

    assert.equal(res.status, 200);
    assert.equal(res.body.success, true);
    assert.equal(res.body.data.totalRows, 4);
    assert.equal(res.body.data.insertedCount, 1);
    assert.equal(res.body.data.skippedInvalidCount, 1);
    assert.equal(res.body.data.skippedDatabaseDuplicateCount, 1);
    assert.equal(res.body.data.skippedCsvDuplicateCount, 1);

    // Verify row outcomes
    const outcomes = res.body.data.rowOutcomes;
    assert.equal(outcomes[0].status, 'INSERTED');
    assert.equal(outcomes[1].status, 'SKIPPED_INVALID');
    assert.equal(outcomes[2].status, 'SKIPPED_DATABASE_DUPLICATE');
    assert.equal(outcomes[3].status, 'SKIPPED_CSV_DUPLICATE');

    // Only 1 candidate record inserted
    assert.equal(insertedRows.length, 1);
  });

  it('26. should return 400 for empty CSV import', async () => {
    setupMockAuth(recruiterUser);

    mock.method(importBatchRepository, 'findById', async () => sampleBatch);
    mock.method(storageService, 'readFile', async () => Buffer.from(''));
    mock.method(importBatchRepository, 'claimForProcessing', async () => true);
    mock.method(importBatchRepository, 'updateStatus', async () => {});

    const res = await request(app)
      .post(`/api/v1/imports/${sampleBatch.id}/confirm`)
      .set('Cookie', ['cvs_session=recruiter-token'])
      .send({ confirm: true });

    assert.equal(res.status, 400);
    assert.equal(res.body.success, false);
  });

  it('27. should be idempotent: repeated confirmation of completed batch returns existing summary without re-inserting', async () => {
    setupMockAuth(recruiterUser);

    const completedBatch: ImportBatchRecord = {
      ...sampleBatch,
      status: 'completed',
      processed_rows: 5,
      successful_rows: 3,
      failed_rows: 2,
      error_summary: {
        skippedInvalidCount: 1,
        skippedDatabaseDuplicateCount: 1,
        skippedCsvDuplicateCount: 0,
        rowOutcomes: [
          { rowNumber: 2, status: 'INSERTED', email: 'user1@example.com' },
          { rowNumber: 3, status: 'INSERTED', email: 'user2@example.com' },
          { rowNumber: 4, status: 'INSERTED', email: 'user3@example.com' },
          { rowNumber: 5, status: 'SKIPPED_INVALID', reason: 'Missing name' },
          { rowNumber: 6, status: 'SKIPPED_DATABASE_DUPLICATE', email: 'dup@example.com' },
        ],
      },
      completed_at: new Date('2026-11-23T10:00:00Z'),
    };

    mock.method(importBatchRepository, 'findById', async () => completedBatch);

    let insertCalled = false;
    mock.method(pool, 'connect', async () =>
      createMockDbClient((sql) => {
        if (sql.includes('INSERT INTO candidates')) {
          insertCalled = true;
        }
        return undefined;
      })
    );

    const res = await request(app)
      .post(`/api/v1/imports/${sampleBatch.id}/confirm`)
      .set('Cookie', ['cvs_session=recruiter-token'])
      .send({ confirm: true });

    assert.equal(res.status, 200);
    assert.equal(res.body.success, true);
    assert.equal(res.body.data.status, 'completed');
    assert.equal(res.body.data.insertedCount, 3);
    assert.equal(res.body.data.skippedInvalidCount, 1);
    assert.equal(res.body.data.skippedDatabaseDuplicateCount, 1);
    assert.equal(insertCalled, false); // No candidates inserted
  });

  it('28. should return 409 conflict when batch is already processing by another concurrent request', async () => {
    setupMockAuth(recruiterUser);

    const processingBatch: ImportBatchRecord = {
      ...sampleBatch,
      status: 'processing',
    };
    mock.method(importBatchRepository, 'findById', async () => processingBatch);
    mock.method(importBatchRepository, 'claimForProcessing', async () => false);

    const res = await request(app)
      .post(`/api/v1/imports/${sampleBatch.id}/confirm`)
      .set('Cookie', ['cvs_session=recruiter-token'])
      .send({ confirm: true });

    assert.equal(res.status, 409);
    assert.equal(res.body.success, false);
    assert.equal(res.body.error.code, 'CONFLICT');
  });

  it('29. should rollback database transaction on candidate insert failure and mark batch failed', async () => {
    setupMockAuth(recruiterUser);

    const csvContent =
      'full_name,email\n' +
      'Fail Candidate,fail.cand@example.com\n';

    mock.method(importBatchRepository, 'findById', async () => sampleBatch);
    mock.method(storageService, 'readFile', async () => Buffer.from(csvContent));
    mock.method(importBatchRepository, 'claimForProcessing', async () => true);

    let rollbackExecuted = false;
    let failedStatusMarked = false;
    mock.method(pool, 'connect', async () =>
      createMockDbClient((sql) => {
        if (sql.includes('INSERT INTO candidates')) {
          throw new Error('PostgreSQL connection drop or simulated failure');
        }
        if (sql.startsWith('ROLLBACK')) {
          rollbackExecuted = true;
        }
        return undefined;
      })
    );
    mock.method(importBatchRepository, 'updateStatus', async (_id: string, status: string) => {
      if (status === 'failed') failedStatusMarked = true;
    });

    const res = await request(app)
      .post(`/api/v1/imports/${sampleBatch.id}/confirm`)
      .set('Cookie', ['cvs_session=recruiter-token'])
      .send({ confirm: true });

    assert.equal(res.status, 500);
    assert.equal(rollbackExecuted, true);
    assert.equal(failedStatusMarked, true);
  });

  it('30. should allow admin to confirm import batch uploaded by any recruiter', async () => {
    setupMockAuth(adminUser);

    const csvContent =
      'full_name,email\n' +
      'Admin Imported,admin.imported@example.com\n';

    mock.method(importBatchRepository, 'findById', async () => sampleBatch); // uploaded by recruiter-uuid-1111
    mock.method(storageService, 'readFile', async () => Buffer.from(csvContent));
    mock.method(importBatchRepository, 'claimForProcessing', async () => true);
    mock.method(pool, 'connect', async () => createMockDbClient());
    mock.method(auditLogRepository, 'logEvent', async () => ({} as any));

    const res = await request(app)
      .post(`/api/v1/imports/${sampleBatch.id}/confirm`)
      .set('Cookie', ['cvs_session=admin-token'])
      .send({ confirm: true });

    assert.equal(res.status, 200);
    assert.equal(res.body.success, true);
    assert.equal(res.body.data.status, 'completed');
    assert.equal(res.body.data.insertedCount, 1);
  });

  it('31. should record audit log with CSV_IMPORT_CONFIRMED and safe summary metadata', async () => {
    setupMockAuth(recruiterUser);

    const csvContent =
      'full_name,email\n' +
      'Audit Test,audit.test@example.com\n';

    mock.method(importBatchRepository, 'findById', async () => sampleBatch);
    mock.method(storageService, 'readFile', async () => Buffer.from(csvContent));
    mock.method(importBatchRepository, 'claimForProcessing', async () => true);
    mock.method(pool, 'connect', async () => createMockDbClient());

    let loggedEvent: any = null;
    mock.method(auditLogRepository, 'logEvent', async (event: any) => {
      loggedEvent = event;
    });

    const res = await request(app)
      .post(`/api/v1/imports/${sampleBatch.id}/confirm`)
      .set('Cookie', ['cvs_session=recruiter-token'])
      .send({ confirm: true });

    assert.equal(res.status, 200);
    assert.ok(loggedEvent);
    assert.equal(loggedEvent.action, 'CSV_IMPORT_CONFIRMED');
    assert.equal(loggedEvent.entityType, 'import_batch');
    assert.equal(loggedEvent.entityId, sampleBatch.id);
    assert.equal(loggedEvent.newValues.insertedCount, 1);
  });
});
