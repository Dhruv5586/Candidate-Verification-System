import { describe, it, mock, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import request from 'supertest';
import { app } from '../app';

describe('Go Auth + Node.js Integration (Auth Middleware & /api/v1/auth/me)', () => {
  afterEach(() => {
    mock.reset();
  });

  const mockUserPayload = {
    valid: true,
    user_id: '550e8400-e29b-41d4-a716-446655440000',
    email: 'recruiter.jane@example.com',
    name: 'Jane Recruiter',
    roles: ['recruiter'],
    session_id: '770e8400-e29b-41d4-a716-446655440002',
    expires_at: '2026-11-30T12:00:00Z',
  };

  it('1. should return 200 and verified user info for valid session cookie', async () => {
    let capturedHeaders: HeadersInit | undefined;
    let capturedBody: string | undefined;

    mock.method(globalThis, 'fetch', async (_url: string | URL | Request, init?: RequestInit) => {
      capturedHeaders = init?.headers;
      capturedBody = init?.body as string;
      return new Response(JSON.stringify(mockUserPayload), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      });
    });

    const res = await request(app)
      .get('/api/v1/auth/me')
      .set('Cookie', ['cvs_session=valid-secret-session-token-123']);

    assert.equal(res.status, 200);
    assert.equal(res.body.success, true);
    assert.equal(res.body.data.user.id, mockUserPayload.user_id);
    assert.equal(res.body.data.user.email, mockUserPayload.email);
    assert.equal(res.body.data.user.name, mockUserPayload.name);
    assert.deepEqual(res.body.data.user.roles, ['recruiter']);
    assert.equal(res.body.data.session.id, mockUserPayload.session_id);

    // Verify internal secret & token were sent to Go Auth
    const headers = capturedHeaders as Record<string, string>;
    assert.ok(headers['X-Internal-Secret']);
    assert.equal(headers['Content-Type'], 'application/json');
    assert.ok(capturedBody?.includes('valid-secret-session-token-123'));
  });

  it('2. should return 401 when session cookie and Authorization header are missing', async () => {
    const res = await request(app).get('/api/v1/auth/me');

    assert.equal(res.status, 401);
    assert.equal(res.body.success, false);
    assert.equal(res.body.error.code, 'UNAUTHORIZED');
    assert.ok(res.body.error.message.includes('missing session token'));
  });

  it('3. should return 401 when Go Auth reports session is invalid', async () => {
    mock.method(globalThis, 'fetch', async () => {
      return new Response(
        JSON.stringify({ valid: false, error: 'session_expired_or_revoked' }),
        { status: 401, headers: { 'Content-Type': 'application/json' } }
      );
    });

    const res = await request(app)
      .get('/api/v1/auth/me')
      .set('Cookie', ['cvs_session=invalid-session-token']);

    assert.equal(res.status, 401);
    assert.equal(res.body.success, false);
    assert.equal(res.body.error.code, 'UNAUTHORIZED');
  });

  it('4. should return 401 when session is expired', async () => {
    mock.method(globalThis, 'fetch', async () => {
      return new Response(
        JSON.stringify({ valid: false, error: 'session_expired_or_revoked' }),
        { status: 401, headers: { 'Content-Type': 'application/json' } }
      );
    });

    const res = await request(app)
      .get('/api/v1/auth/me')
      .set('Cookie', ['cvs_session=expired-session-token']);

    assert.equal(res.status, 401);
    assert.equal(res.body.success, false);
    assert.equal(res.body.error.code, 'UNAUTHORIZED');
  });

  it('5. should return 401 when session is revoked', async () => {
    mock.method(globalThis, 'fetch', async () => {
      return new Response(
        JSON.stringify({ valid: false, error: 'session_expired_or_revoked' }),
        { status: 401, headers: { 'Content-Type': 'application/json' } }
      );
    });

    const res = await request(app)
      .get('/api/v1/auth/me')
      .set('Cookie', ['cvs_session=revoked-session-token']);

    assert.equal(res.status, 401);
    assert.equal(res.body.success, false);
    assert.equal(res.body.error.code, 'UNAUTHORIZED');
  });

  it('6. should return 503 Service Unavailable when Go Auth is unreachable or times out', async () => {
    mock.method(globalThis, 'fetch', async () => {
      throw new Error('fetch failed: connect ECONNREFUSED 127.0.0.1:8080');
    });

    const res = await request(app)
      .get('/api/v1/auth/me')
      .set('Cookie', ['cvs_session=any-session-token']);

    assert.equal(res.status, 503);
    assert.equal(res.body.success, false);
    assert.equal(res.body.error.code, 'SERVICE_UNAVAILABLE');
    assert.ok(res.body.error.message.includes('unavailable'));
  });

  it('7. should fail securely (503) when internal service secret is rejected by Go Auth', async () => {
    mock.method(globalThis, 'fetch', async () => {
      return new Response(
        JSON.stringify({ valid: false, error: 'unauthorized_service_call' }),
        { status: 401, headers: { 'Content-Type': 'application/json' } }
      );
    });

    const res = await request(app)
      .get('/api/v1/auth/me')
      .set('Cookie', ['cvs_session=any-token']);

    assert.equal(res.status, 503);
    assert.equal(res.body.success, false);
    assert.equal(res.body.error.code, 'SERVICE_UNAVAILABLE');
  });

  it('8. should return verified user information and never leak sensitive tokens', async () => {
    mock.method(globalThis, 'fetch', async () => {
      return new Response(JSON.stringify(mockUserPayload), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      });
    });

    // Also tests Bearer token fallback
    const res = await request(app)
      .get('/api/v1/auth/me')
      .set('Authorization', 'Bearer valid-secret-bearer-token');

    assert.equal(res.status, 200);
    assert.equal(res.body.success, true);
    assert.ok(res.body.data.user);
    assert.equal(res.body.data.user.email, 'recruiter.jane@example.com');

    // Strict security check: ensure raw tokens and internal secrets are NEVER in response
    const jsonStr = JSON.stringify(res.body);
    assert.equal(jsonStr.includes('valid-secret-bearer-token'), false);
    assert.equal(jsonStr.includes('dev-internal-secret'), false);
    assert.equal(jsonStr.includes('access_token'), false);
    assert.equal(jsonStr.includes('refresh_token'), false);
    assert.equal(jsonStr.includes('password'), false);
  });
});
