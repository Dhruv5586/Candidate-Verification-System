import { checkDatabaseConnection } from '../config/database';
import { env } from '../config/env';
import { DatabaseHealthStatus, HealthStatus } from '../types/api.types';

export class HealthService {
  private readonly startTime: number;

  constructor() {
    this.startTime = Date.now();
  }

  public getHealth(): HealthStatus {
    const uptimeSeconds = Math.floor((Date.now() - this.startTime) / 1000);
    return {
      status: 'healthy',
      service: 'candidate-verification-node-api',
      version: '1.0.0',
      environment: env.NODE_ENV,
      uptimeSeconds,
      timestamp: new Date().toISOString(),
    };
  }

  public async getDatabaseHealth(): Promise<DatabaseHealthStatus> {
    const start = Date.now();
    const isConnected = await checkDatabaseConnection();
    const responseTimeMs = Date.now() - start;

    return {
      status: isConnected ? 'connected' : 'disconnected',
      database: 'PostgreSQL (candidate_verification)',
      responseTimeMs,
      timestamp: new Date().toISOString(),
    };
  }
}

export const healthService = new HealthService();
