import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { envSchema } from '../config/env';

describe('Environment Configuration Validation (Zod)', () => {
  const validConfig = {
    PORT: '3000',
    NODE_ENV: 'development',
    DATABASE_URL: 'postgres://postgres:secret@localhost:5432/candidate_verification',
    GO_AUTH_INTERNAL_URL: 'http://localhost:8080',
    INTERNAL_SERVICE_SECRET: 'super-secret-internal-key-32-chars-long',
    CORS_ALLOWED_ORIGINS: 'http://localhost:3000,http://localhost:8080',
  };

  it('should successfully parse valid configuration', () => {
    const result = envSchema.safeParse(validConfig);
    assert.equal(result.success, true);
    if (result.success) {
      assert.equal(result.data.PORT, 3000);
      assert.equal(result.data.NODE_ENV, 'development');
      assert.deepEqual(result.data.CORS_ALLOWED_ORIGINS, [
        'http://localhost:3000',
        'http://localhost:8080',
      ]);
    }
  });

  it('should reject invalid PORT value', () => {
    const invalidConfig = { ...validConfig, PORT: '99999' };
    const result = envSchema.safeParse(invalidConfig);
    assert.equal(result.success, false);
  });

  it('should reject non-postgres DATABASE_URL', () => {
    const invalidConfig = { ...validConfig, DATABASE_URL: 'mysql://root:pass@localhost:3306/db' };
    const result = envSchema.safeParse(invalidConfig);
    assert.equal(result.success, false);
  });

  it('should reject short INTERNAL_SERVICE_SECRET', () => {
    const invalidConfig = { ...validConfig, INTERNAL_SERVICE_SECRET: 'too-short' };
    const result = envSchema.safeParse(invalidConfig);
    assert.equal(result.success, false);
  });
});
