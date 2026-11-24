import { Request, Response, NextFunction } from 'express';
import { UnauthorizedError } from '../utils/errors';
import { goAuthClient } from '../services/goAuth.client';

export const SESSION_COOKIE_NAME = 'cvs_session';

/**
 * Authentication middleware that verifies session tokens with the Go Auth service.
 * Supports HTTP-only cookie `cvs_session` and `Authorization: Bearer <token>` fallback.
 * Attaches verified `req.user` context upon success.
 */
export async function authenticate(
  req: Request,
  _res: Response,
  next: NextFunction
): Promise<void> {
  try {
    let sessionToken: string | undefined;

    // 1. Read from HTTP-only cookie first
    if (req.cookies && typeof req.cookies[SESSION_COOKIE_NAME] === 'string') {
      sessionToken = req.cookies[SESSION_COOKIE_NAME];
    }

    // 2. Fall back to Bearer token in Authorization header
    if (!sessionToken && req.headers.authorization) {
      const authHeader = req.headers.authorization;
      if (authHeader.startsWith('Bearer ')) {
        sessionToken = authHeader.substring(7).trim();
      }
    }

    if (!sessionToken) {
      throw new UnauthorizedError('Authentication required: missing session token');
    }

    // 3. Authenticate with Go Auth internal API
    const user = await goAuthClient.validateSession(sessionToken);

    // 4. Attach verified user context to request
    req.user = user;

    next();
  } catch (err) {
    next(err);
  }
}
