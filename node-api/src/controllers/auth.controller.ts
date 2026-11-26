import { Request, Response, NextFunction } from 'express';
import crypto from 'crypto';
import { UnauthorizedError } from '../utils/errors';
import { ApiResponse } from '../types/api.types';
import { pool } from '../config/database';
import { SESSION_COOKIE_NAME } from '../middleware/authenticate';

export class AuthController {
  /**
   * GET /api/v1/auth/me
   * Returns authenticated user profile and session validity metadata.
   * Never exposes raw session tokens or internal secrets.
   */
  public async getMe(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      if (!req.user) {
        throw new UnauthorizedError('Unauthenticated request context');
      }

      const response: ApiResponse = {
        success: true,
        data: {
          user: {
            id: req.user.id,
            email: req.user.email,
            name: req.user.name,
            roles: req.user.roles,
          },
          session: {
            id: req.user.sessionId,
            expiresAt: req.user.expiresAt,
          },
        },
        meta: {
          timestamp: new Date().toISOString(),
          version: 'v1',
        },
      };

      res.cookie('cvs_auth_user', JSON.stringify({
        user: {
          id: req.user.id,
          email: req.user.email,
          name: req.user.name,
          roles: req.user.roles,
        },
        session: {
          id: req.user.sessionId,
          expiresAt: req.user.expiresAt,
        },
      }), {
        httpOnly: false,
        path: '/',
        maxAge: 30 * 60 * 1000,
        sameSite: 'lax',
      });

      res.status(200).json(response);
    } catch (err) {
      next(err);
    }
  }

  /**
   * GET /api/v1/auth/users
   * Returns active system users and their assigned roles for UI role selection.
   */
  public async getUsers(_req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      const result = await pool.query(`
        SELECT u.id, u.name, u.email, array_remove(array_agg(r.name), NULL) as roles
        FROM users u
        LEFT JOIN user_roles ur ON ur.user_id = u.id
        LEFT JOIN roles r ON r.id = ur.role_id
        WHERE u.is_active = true
        GROUP BY u.id, u.name, u.email
        ORDER BY u.name ASC;
      `);

      res.status(200).json({
        success: true,
        data: result.rows,
        meta: { timestamp: new Date().toISOString() },
      });
    } catch (err) {
      next(err);
    }
  }

  /**
   * POST /api/v1/auth/dev-session
   * Generates a valid session for local development and UI preview.
   * Creates a session token in PostgreSQL sessions table and issues cvs_session cookie.
   */
  public async createDevSession(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      const { role, email } = req.body || {};

      let userQuery = `
        SELECT u.id, u.name, u.email, array_remove(array_agg(r.name), NULL) as roles
        FROM users u
        LEFT JOIN user_roles ur ON ur.user_id = u.id
        LEFT JOIN roles r ON r.id = ur.role_id
        WHERE u.is_active = true
      `;
      const queryParams: any[] = [];

      const roleDefaults: Record<string, string> = {
        admin: 'dhruvdobariya5886@gmail.com',
        recruiter: 'elena.recruiter@cvs.internal',
        reviewer: 'sarah.reviewer@cvs.internal',
      };

      if (email) {
        queryParams.push(email);
        userQuery += ` AND u.email = $${queryParams.length}`;
      } else if (role && roleDefaults[role.toLowerCase()]) {
        queryParams.push(roleDefaults[role.toLowerCase()]);
        userQuery += ` AND u.email = $${queryParams.length}`;
      } else if (role) {
        queryParams.push(role);
        userQuery += ` AND r.name = $${queryParams.length}`;
      }

      userQuery += ` GROUP BY u.id, u.name, u.email LIMIT 1;`;

      const userRes = await pool.query(userQuery, queryParams);
      if (userRes.rows.length === 0) {
        res.status(404).json({
          success: false,
          error: { code: 'NOT_FOUND', message: `No active user found matching criteria (role: ${role || 'any'}, email: ${email || 'any'})` },
        });
        return;
      }

      const user = userRes.rows[0];

      // Generate 256-bit URL-safe token matching Go Auth format
      const rawToken = crypto.randomBytes(32).toString('base64url');
      const tokenHash = crypto.createHash('sha256').update(rawToken).digest('hex');

      const ip = req.ip || req.socket.remoteAddress || '127.0.0.1';
      const userAgent = req.headers['user-agent'] || 'CVS-Frontend';

      const sessionRes = await pool.query(
        `INSERT INTO sessions (user_id, token_hash, expires_at, is_revoked, created_at, last_accessed_at, ip_address, user_agent)
         VALUES ($1, $2, NOW() + INTERVAL '30 minutes', false, NOW(), NOW(), $3, $4)
         RETURNING id, expires_at;`,
        [user.id, tokenHash, ip, userAgent]
      );

      const session = sessionRes.rows[0];

      // Set cookie for browser navigation (30 minutes expiry)
      res.cookie(SESSION_COOKIE_NAME, rawToken, {
        httpOnly: true,
        path: '/',
        maxAge: 30 * 60 * 1000, // 30 minutes in milliseconds
        sameSite: 'lax',
      });

      res.cookie('cvs_auth_user', JSON.stringify({
        user: {
          id: user.id,
          email: user.email,
          name: user.name,
          roles: user.roles,
        },
        session: {
          id: session.id,
          expiresAt: session.expires_at,
        },
      }), {
        httpOnly: false,
        path: '/',
        maxAge: 30 * 60 * 1000,
        sameSite: 'lax',
      });

      res.status(200).json({
        success: true,
        data: {
          user: {
            id: user.id,
            email: user.email,
            name: user.name,
            roles: user.roles,
          },
          session: {
            id: session.id,
            expiresAt: session.expires_at,
          },
          sessionToken: rawToken,
        },
        meta: { timestamp: new Date().toISOString() },
      });
    } catch (err) {
      next(err);
    }
  }

  /**
   * POST /api/v1/auth/logout
   * Clears the session cookie and revokes the session in PostgreSQL.
   */
  public async logout(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      let sessionToken: string | undefined;
      if (req.cookies && typeof req.cookies[SESSION_COOKIE_NAME] === 'string') {
        sessionToken = req.cookies[SESSION_COOKIE_NAME];
      }
      if (!sessionToken && req.headers.authorization?.startsWith('Bearer ')) {
        sessionToken = req.headers.authorization.substring(7).trim();
      }

      if (sessionToken) {
        const tokenHash = crypto.createHash('sha256').update(sessionToken).digest('hex');
        await pool.query('UPDATE sessions SET is_revoked = true WHERE token_hash = $1', [tokenHash]);
      }

      res.clearCookie('cvs_auth_user', { path: '/' });
      res.clearCookie(SESSION_COOKIE_NAME, { path: '/' });
      res.status(200).json({
        success: true,
        data: { message: 'Logged out successfully and session revoked' },
        meta: { timestamp: new Date().toISOString() },
      });
    } catch (err) {
      next(err);
    }
  }
}

export const authController = new AuthController();
