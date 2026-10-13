import type { Role } from './constants';
import type { Permission } from './permissions';

export interface InstitutionSummary {
  id: number;
  name: string;
  slug: string;
  logo_url: string;
  primary_color: string;
  plan: string;
  status: string;
  currency: string;
  timezone: string;
  locale: string;
}

export interface SessionUser {
  id: number;
  role: Role;
  institution_id: number | null;
  full_name: string;
  email: string;
  ref_id: number | null;
  must_change_password: boolean;
  mfa_enabled: boolean;
  /** Admin roles must enrol in 2FA before using the app (when ADMIN_MFA=required). */
  mfa_enrollment_required: boolean;
  permissions: Permission[];
}

export interface AuthResponse {
  access_token: string;
  expires_in: number;
  user: SessionUser;
  institution: InstitutionSummary | null;
}

export interface MfaChallengeResponse {
  mfa_required: true;
  mfa_token: string;
}

export interface ApiErrorBody {
  error: string;
  code?: string;
  details?: unknown;
  request_id?: string;
}
