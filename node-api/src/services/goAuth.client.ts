import { env } from '../config/env';
import {
  UnauthorizedError,
  BadRequestError,
  ServiceUnavailableError,
  AppError,
} from '../utils/errors';
import { logger } from '../utils/logger';
import { AuthenticatedUser, ValidateSessionResponse } from '../types/auth.types';

export class GoAuthClient {
  private readonly baseUrl: string;
  private readonly internalSecret: string;
  private readonly timeoutMs: number;

  constructor(
    baseUrl: string = env.GO_AUTH_INTERNAL_URL,
    internalSecret: string = env.INTERNAL_SERVICE_SECRET,
    timeoutMs: number = 5000
  ) {
    this.baseUrl = baseUrl.replace(/\/+$/, '');
    this.internalSecret = internalSecret;
    this.timeoutMs = timeoutMs;
  }

  /**
   * Validate a session token against the Go Auth service via the internal API.
   * Never logs raw tokens or secrets.
   */
  public async validateSession(sessionToken: string): Promise<AuthenticatedUser> {
    const trimmedToken = sessionToken?.trim();
    if (!trimmedToken) {
      throw new UnauthorizedError('Missing session token');
    }

    const validateUrl = `${this.baseUrl}/internal/session/validate`;

    let response: Response;
    try {
      response = await fetch(validateUrl, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-Internal-Secret': this.internalSecret,
        },
        body: JSON.stringify({ session_token: trimmedToken }),
        signal: AbortSignal.timeout(this.timeoutMs),
      });
    } catch (err: any) {
      if (err.name === 'TimeoutError' || err.name === 'AbortError') {
        logger.error({ url: validateUrl }, 'Go Auth service request timed out');
        throw new ServiceUnavailableError('Authentication service request timed out');
      }

      logger.error({ err: err.message, url: validateUrl }, 'Failed to connect to Go Auth service');
      throw new ServiceUnavailableError('Authentication service is currently unavailable');
    }

    if (response.status === 401) {
      let errBody: ValidateSessionResponse | undefined;
      try {
        errBody = (await response.json()) as ValidateSessionResponse;
      } catch {
        // Ignored
      }

      if (errBody?.error === 'unauthorized_service_call') {
        logger.error('Go Auth rejected internal service secret (X-Internal-Secret mismatch)');
        throw new ServiceUnavailableError('Internal authentication service misconfiguration');
      }

      throw new UnauthorizedError('Session invalid, expired, or revoked');
    }

    if (response.status === 400) {
      throw new BadRequestError('Invalid session verification request');
    }

    if (!response.ok) {
      logger.error({ status: response.status }, 'Go Auth service returned non-OK status');
      throw new ServiceUnavailableError('Authentication service error');
    }

    let data: ValidateSessionResponse;
    try {
      data = (await response.json()) as ValidateSessionResponse;
    } catch (parseErr) {
      logger.error({ parseErr }, 'Failed to parse Go Auth validation response');
      throw new ServiceUnavailableError('Invalid response from authentication service');
    }

    if (!data.valid || !data.user_id || !data.email) {
      throw new UnauthorizedError(data.error || 'Session validation failed');
    }

    return {
      id: data.user_id,
      email: data.email,
      name: data.name || '',
      roles: data.roles || [],
      sessionId: data.session_id || '',
      expiresAt: data.expires_at || '',
    };
  }
}

export const goAuthClient = new GoAuthClient();
