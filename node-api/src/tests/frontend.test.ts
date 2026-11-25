import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import request from 'supertest';
import { app } from '../app';

describe('Frontend Static Serving & Web Console Routes', () => {
  it('GET / should return 200 and serve frontend index.html', async () => {
    const res = await request(app).get('/');
    assert.equal(res.status, 200);
    assert.ok(res.text.includes('Candidate Verification System'));
    assert.ok(res.text.includes('CVS'));
  });

  it('GET /index.html should redirect 301 to / for clean URLs', async () => {
    const res = await request(app).get('/index.html');
    assert.equal(res.status, 301);
    assert.equal(res.header.location, '/');
  });

  it('GET /login should return 200 and serve Sign In interface', async () => {
    const res = await request(app).get('/login');
    assert.equal(res.status, 200);
    assert.ok(res.text.includes('Sign in to console'));
    assert.ok(res.text.includes('Continue with Google'));
  });

  it('GET /dashboard should return 200 and serve Admin Dashboard', async () => {
    const res = await request(app).get('/dashboard');
    assert.equal(res.status, 200);
    assert.ok(res.text.includes('Admin Dashboard'));
    assert.ok(res.text.includes('Total Candidates'));
  });

  it('GET /candidates should return 200 and serve Candidates Directory', async () => {
    const res = await request(app).get('/candidates');
    assert.equal(res.status, 200);
    assert.ok(res.text.includes('Candidates Directory'));
    assert.ok(res.text.includes('Bulk Candidate CSV Import'));
  });

  it('GET /candidate-detail should return 200 and serve Dossier', async () => {
    const res = await request(app).get('/candidate-detail');
    assert.equal(res.status, 200);
    assert.ok(res.text.includes('Candidate Verification Dossier'));
    assert.ok(res.text.includes('Automated Verification Findings'));
  });

  it('GET /reviewer should return 200 and serve Reviewer Queue', async () => {
    const res = await request(app).get('/reviewer');
    assert.equal(res.status, 200);
    assert.ok(res.text.includes('Compliance Review Queue'));
    assert.ok(res.text.includes('Assigned Verifications'));
  });

  it('GET /dashboard.html should redirect 301 to /dashboard for clean URLs', async () => {
    const res = await request(app).get('/dashboard.html');
    assert.equal(res.status, 301);
    assert.equal(res.header.location, '/dashboard');
  });

  it('GET /api/v1/auth/users should return 200 with active system users', async () => {
    const res = await request(app).get('/api/v1/auth/users');
    assert.equal(res.status, 200);
    assert.equal(res.body.success, true);
    assert.ok(Array.isArray(res.body.data));
    assert.ok(res.body.data.length >= 2);
  });

  it('POST /api/v1/auth/dev-session should generate valid session cookie', async () => {
    const res = await request(app)
      .post('/api/v1/auth/dev-session')
      .send({ role: 'admin' });
    assert.equal(res.status, 200);
    assert.equal(res.body.success, true);
    assert.ok(res.body.data.sessionToken);
    assert.equal(res.body.data.user.email, 'dhruvdobariya5886@gmail.com');
  });
});
