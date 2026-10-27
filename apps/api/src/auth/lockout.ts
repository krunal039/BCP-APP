export const MAX_FAILED_LOGINS = 5;
export const LOCKOUT_DURATION_MS = 15 * 60 * 1000;

export function isAccountLocked(lockedUntil: Date | null, now = new Date()): boolean {
  return lockedUntil != null && lockedUntil.getTime() > now.getTime();
}

export function nextFailedLoginState(
  currentFailedCount: number,
  now = new Date(),
): { failedLoginCount: number; lockedUntil: Date | null } {
  const failedLoginCount = currentFailedCount + 1;
  if (failedLoginCount >= MAX_FAILED_LOGINS) {
    return {
      failedLoginCount,
      lockedUntil: new Date(now.getTime() + LOCKOUT_DURATION_MS),
    };
  }
  return { failedLoginCount, lockedUntil: null };
}
