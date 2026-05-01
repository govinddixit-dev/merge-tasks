/**
 * Auth types — used for local JWT session management.
 */

export interface SessionUser {
  openId: string;
  name: string | null;
  email: string | null;
  loginMethod: string | null;
}
