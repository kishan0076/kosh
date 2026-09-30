/** Account validation shared by the API (register / admin-create) and the web forms, so both sides
 *  agree on what a valid email and password are. Pure, dependency-free, unit-tested. */

/** The minimum length a password must be. */
export const MIN_PASSWORD_LENGTH = 8;

/** A pragmatic email check: one @, non-empty local part, a dotted domain, no spaces. Not RFC-perfect
 *  (that's neither possible nor useful here) — it rejects the obvious mistakes and normalizes case. */
export function isValidEmail(email: string): boolean {
  const e = email.trim();
  if (e.length < 3 || e.length > 320 || /\s/.test(e)) return false;
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(e);
}

/**
 * Return a human-readable reason a password is unacceptable, or null when it's fine. Kept deliberately
 * simple: a length floor and a guard against absurdly long inputs (a scrypt DoS vector).
 */
export function passwordProblem(password: string): string | null {
  if (typeof password !== "string" || password.length < MIN_PASSWORD_LENGTH) {
    return `Password must be at least ${MIN_PASSWORD_LENGTH} characters.`;
  }
  if (password.length > 200) return "Password is too long.";
  return null;
}
