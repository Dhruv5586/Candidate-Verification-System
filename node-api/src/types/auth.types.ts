export interface AuthenticatedUser {
  id: string;
  email: string;
  name: string;
  roles: string[];
  sessionId: string;
  expiresAt: string;
}

export interface ValidateSessionResponse {
  valid: boolean;
  user_id?: string;
  email?: string;
  name?: string;
  roles?: string[];
  session_id?: string;
  expires_at?: string;
  error?: string;
}

declare global {
  namespace Express {
    interface Request {
      user?: AuthenticatedUser;
    }
  }
}
