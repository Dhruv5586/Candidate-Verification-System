export type AppRole = 'admin' | 'recruiter' | 'reviewer';

export const APP_ROLES: AppRole[] = ['admin', 'recruiter', 'reviewer'];

export interface RoleRecord {
  id: string;
  name: AppRole;
  description: string | null;
  created_at: Date;
}

export interface UserRoleRecord {
  user_id: string;
  role_id: string;
  assigned_at: Date;
}

export interface RoleAssignmentPayload {
  targetUserId: string;
  roleName: AppRole;
}

export type AuditLogAction =
  | 'ROLE_ASSIGNED'
  | 'ROLE_REMOVED'
  | 'ROLE_CHANGED'
  | 'UNAUTHORIZED_ACCESS_ATTEMPT';

export interface AuditLogRecord {
  id: string;
  user_id: string | null;
  action: AuditLogAction | string;
  entity_type: string;
  entity_id: string | null;
  old_values: Record<string, any> | null;
  new_values: Record<string, any> | null;
  ip_address: string | null;
  user_agent: string | null;
  created_at: Date;
}
