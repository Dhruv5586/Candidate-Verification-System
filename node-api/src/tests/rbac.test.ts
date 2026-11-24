import { describe, it, mock, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import request from 'supertest';
import { app } from '../app';
import { userRoleRepository } from '../repositories/userRole.repository';
import { resourceAuthService } from '../services/resourceAuth.service';
import { roleService } from '../services/role.service';
import { AuthenticatedUser } from '../types/auth.types';

describe('Phase 7: Role-Based Access Control (RBAC) Test Suite', () => {
  afterEach(() => {
    mock.reset();
  });

  const createMockAuthUser = (roles: string[], id = 'user-uuid-1111'): any => ({
    valid: true,
    user_id: id,
    email: `${roles[0] || 'norole'}@example.com`,
    name: `Test ${roles[0] || 'User'}`,
    roles,
    session_id: 'session-uuid-2222',
    expires_at: '2026-11-30T12:00:00Z',
  });

  const setupMockAuth = (roles: string[], id = 'user-uuid-1111') => {
    const payload = createMockAuthUser(roles, id);
    mock.method(globalThis, 'fetch', async () => {
      return new Response(JSON.stringify(payload), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      });
    });
    // Mock userRoleRepository.getUserRoles to return matching roles
    mock.method(userRoleRepository, 'getUserRoles', async () => roles as any);
  };

  it('1. should return 401 for unauthenticated request to protected RBAC route', async () => {
    const res = await request(app).get('/api/v1/rbac/admin');

    assert.equal(res.status, 401);
    assert.equal(res.body.success, false);
    assert.equal(res.body.error.code, 'UNAUTHORIZED');
  });

  it('2. should return 200 when admin accesses admin route', async () => {
    setupMockAuth(['admin']);

    const res = await request(app)
      .get('/api/v1/rbac/admin')
      .set('Cookie', ['cvs_session=admin-session-token']);

    assert.equal(res.status, 200);
    assert.equal(res.body.success, true);
    assert.equal(res.body.data.authorizedRole, 'admin');
    assert.ok(res.body.data.permissions.includes('assign_roles'));
    assert.ok(res.body.data.permissions.includes('view_audit_logs'));
  });

  it('3. should return 200 when recruiter accesses recruiter route', async () => {
    setupMockAuth(['recruiter']);

    const res = await request(app)
      .get('/api/v1/rbac/recruiter')
      .set('Cookie', ['cvs_session=recruiter-session-token']);

    assert.equal(res.status, 200);
    assert.equal(res.body.success, true);
    assert.equal(res.body.data.authorizedRole, 'recruiter');
    assert.ok(res.body.data.permissions.includes('create_candidates'));
    assert.ok(res.body.data.permissions.includes('start_verification'));
  });

  it('4. should return 200 when reviewer accesses reviewer route', async () => {
    setupMockAuth(['reviewer']);

    const res = await request(app)
      .get('/api/v1/rbac/reviewer')
      .set('Cookie', ['cvs_session=reviewer-session-token']);

    assert.equal(res.status, 200);
    assert.equal(res.body.success, true);
    assert.equal(res.body.data.authorizedRole, 'reviewer');
    assert.ok(res.body.data.permissions.includes('submit_verification_reviews'));
  });

  it('5. should return 403 Forbidden when recruiter attempts admin route', async () => {
    setupMockAuth(['recruiter']);

    const res = await request(app)
      .get('/api/v1/rbac/admin')
      .set('Cookie', ['cvs_session=recruiter-session-token']);

    assert.equal(res.status, 403);
    assert.equal(res.body.success, false);
    assert.equal(res.body.error.code, 'FORBIDDEN');
    assert.ok(res.body.error.message.includes("'admin'"));
  });

  it('6. should return 403 Forbidden when reviewer attempts recruiter route', async () => {
    setupMockAuth(['reviewer']);

    const res = await request(app)
      .get('/api/v1/rbac/recruiter')
      .set('Cookie', ['cvs_session=reviewer-session-token']);

    assert.equal(res.status, 403);
    assert.equal(res.body.success, false);
    assert.equal(res.body.error.code, 'FORBIDDEN');
    assert.ok(res.body.error.message.includes("'recruiter'"));
  });

  it('7. should return 403 Forbidden when user has no assigned roles', async () => {
    setupMockAuth([]);

    const res = await request(app)
      .get('/api/v1/rbac/recruiter')
      .set('Cookie', ['cvs_session=norole-session-token']);

    assert.equal(res.status, 403);
    assert.equal(res.body.success, false);
    assert.equal(res.body.error.code, 'FORBIDDEN');
  });

  it('8. should return 200 for user with multiple assigned roles accessing allowed endpoints', async () => {
    setupMockAuth(['recruiter', 'reviewer']);

    const resRecruiter = await request(app)
      .get('/api/v1/rbac/recruiter')
      .set('Cookie', ['cvs_session=multi-session-token']);
    assert.equal(resRecruiter.status, 200);

    const resReviewer = await request(app)
      .get('/api/v1/rbac/reviewer')
      .set('Cookie', ['cvs_session=multi-session-token']);
    assert.equal(resReviewer.status, 200);

    const resAdmin = await request(app)
      .get('/api/v1/rbac/admin')
      .set('Cookie', ['cvs_session=multi-session-token']);
    assert.equal(resAdmin.status, 403);
  });

  it('9. should return 401 when user context is missing or invalid', async () => {
    mock.method(globalThis, 'fetch', async () => {
      return new Response(JSON.stringify({ valid: false, error: 'invalid_session' }), {
        status: 401,
        headers: { 'Content-Type': 'application/json' },
      });
    });

    const res = await request(app)
      .get('/api/v1/rbac/admin')
      .set('Cookie', ['cvs_session=invalid-session-token']);

    assert.equal(res.status, 401);
    assert.equal(res.body.success, false);
  });

  it('10. should return 503 when database lookup fails during authorization', async () => {
    mock.method(globalThis, 'fetch', async () => {
      return new Response(JSON.stringify(createMockAuthUser(['admin'])), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      });
    });

    mock.method(userRoleRepository, 'getUserRoles', async () => {
      throw new Error('PostgreSQL connection dropped');
    });

    const res = await request(app)
      .get('/api/v1/rbac/admin')
      .set('Cookie', ['cvs_session=admin-session-token']);

    assert.equal(res.status, 503);
    assert.equal(res.body.success, false);
    assert.equal(res.body.error.code, 'SERVICE_UNAVAILABLE');
  });

  it('11. should enforce role assignment rules (non-admin and self-assignment prohibited)', async () => {
    // A: Non-admin trying to assign role
    const nonAdminUser: AuthenticatedUser = {
      id: 'recruiter-uuid',
      email: 'recruiter@example.com',
      name: 'Recruiter User',
      roles: ['recruiter'],
      sessionId: 's-1',
      expiresAt: '2026-11-30T12:00:00Z',
    };

    await assert.rejects(
      async () => {
        await roleService.assignRole(nonAdminUser, 'target-uuid', 'admin');
      },
      (err: any) => {
        assert.equal(err.statusCode, 403);
        assert.ok(err.message.includes('only administrators'));
        return true;
      }
    );

    // B: Admin trying to assign role to themselves (self-assignment prohibited)
    const adminUser: AuthenticatedUser = {
      id: 'admin-uuid-self',
      email: 'admin@example.com',
      name: 'Admin User',
      roles: ['admin'],
      sessionId: 's-2',
      expiresAt: '2026-11-30T12:00:00Z',
    };

    await assert.rejects(
      async () => {
        await roleService.assignRole(adminUser, 'admin-uuid-self', 'reviewer');
      },
      (err: any) => {
        assert.equal(err.statusCode, 403);
        assert.ok(err.message.includes('Self-assignment of roles is strictly prohibited'));
        return true;
      }
    );
  });

  it('12. should correctly enforce resource-level authorization boundaries', async () => {
    const adminUser: AuthenticatedUser = {
      id: 'admin-1',
      email: 'admin@example.com',
      name: 'Admin',
      roles: ['admin'],
      sessionId: 's-1',
      expiresAt: '',
    };
    const recruiterUser: AuthenticatedUser = {
      id: 'recruiter-1',
      email: 'recruiter@example.com',
      name: 'Recruiter',
      roles: ['recruiter'],
      sessionId: 's-2',
      expiresAt: '',
    };
    const reviewerUser: AuthenticatedUser = {
      id: 'reviewer-1',
      email: 'reviewer@example.com',
      name: 'Reviewer',
      roles: ['reviewer'],
      sessionId: 's-3',
      expiresAt: '',
    };

    // Candidate resource access
    assert.equal(
      await resourceAuthService.canAccessCandidate(adminUser, { candidateId: 'c-1', recruiterId: 'other' }),
      true
    );
    assert.equal(
      await resourceAuthService.canAccessCandidate(recruiterUser, { candidateId: 'c-1', recruiterId: 'recruiter-1' }),
      true
    );
    assert.equal(
      await resourceAuthService.canAccessCandidate(recruiterUser, { candidateId: 'c-1', recruiterId: 'other-recruiter' }),
      false
    );
    assert.equal(
      await resourceAuthService.canAccessCandidate(reviewerUser, { candidateId: 'c-1', recruiterId: 'recruiter-1' }),
      false
    );

    // Verification review submission
    assert.equal(
      await resourceAuthService.canReviewVerification(adminUser, { verificationId: 'v-1', candidateId: 'c-1' }),
      true
    );
    assert.equal(
      await resourceAuthService.canReviewVerification(reviewerUser, { verificationId: 'v-1', candidateId: 'c-1', assignedReviewerId: 'reviewer-1' }),
      true
    );
    assert.equal(
      await resourceAuthService.canReviewVerification(reviewerUser, { verificationId: 'v-1', candidateId: 'c-1', assignedReviewerId: 'other-reviewer' }),
      false
    );
    // Recruiter can NEVER review verifications
    assert.equal(
      await resourceAuthService.canReviewVerification(recruiterUser, { verificationId: 'v-1', candidateId: 'c-1' }),
      false
    );
  });
});
