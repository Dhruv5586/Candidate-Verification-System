import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import request from 'supertest';
import { app } from '../app';

describe('Node.js Express App & Health Endpoints', () => {
  it('GET /api/v1/health should return 200 and healthy status', async () => {
    const res = await request(app).get('/api/v1/health');

    assert.equal(res.status, 200);
    assert.equal(res.body.success, true);
    assert.equal(res.body.data.status, 'healthy');
    assert.equal(res.body.data.service, 'candidate-verification-node-api');
    assert.ok(typeof res.body.data.uptimeSeconds === 'number');
    assert.ok(typeof res.body.data.timestamp === 'string');
  });

  it('GET /api/v1/health/database should return 200 and connected status', async () => {
    const res = await request(app).get('/api/v1/health/database');

    assert.equal(res.status, 200);
    assert.equal(res.body.success, true);
    assert.equal(res.body.data.status, 'connected');
    assert.ok(res.body.data.database.includes('candidate_verification'));
    assert.ok(typeof res.body.data.responseTimeMs === 'number');
  });

  it('GET /api/v1/non-existent-route should return 404 with standardized error', async () => {
    const res = await request(app).get('/api/v1/non-existent-route');

    assert.equal(res.status, 404);
    assert.equal(res.body.success, false);
    assert.equal(res.body.error.code, 'NOT_FOUND');
    assert.ok(res.body.error.message.includes('/api/v1/non-existent-route'));
  });

  it('GET /api/v1/docs/json should return OpenAPI 3.0 specification', async () => {
    const res = await request(app).get('/api/v1/docs/json');

    assert.equal(res.status, 200);
    assert.equal(res.body.openapi, '3.0.3');
    assert.equal(res.body.info.title, 'Candidate Verification System - Node.js API');
  });
});
