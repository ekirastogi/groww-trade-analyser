import type { User } from 'firebase/auth';

/**
 * Google accounts allowed to use this app.
 * Keep in sync with `isOwner()` in firestore.rules (frontend/ and repo root).
 */
export const ALLOWED_GOOGLE_EMAILS: readonly string[] = ['ekirastogi@gmail.com'];

const allowed = new Set(ALLOWED_GOOGLE_EMAILS.map((email) => email.toLowerCase()));

export function isAllowedGoogleEmail(email: string | null | undefined): boolean {
  return !!email && allowed.has(email.trim().toLowerCase());
}

export function isAllowedGoogleUser(user: User | null | undefined): boolean {
  if (!user) return false;
  if (!user.emailVerified) return false;
  return isAllowedGoogleEmail(user.email);
}

export const ACCESS_DENIED_MESSAGE =
  'This workspace is private. Sign in with the Google account that owns it.';
