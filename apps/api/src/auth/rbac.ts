import type { Role } from "@bcp/shared";

/**
 * Server-side role checks. Clients must never be trusted for authorization.
 * Approver ≠ Sender for alerts is enforced later in the approvals epic (E4);
 * this helper only gates route access by role set.
 */
export function hasAnyRole(
  userRoles: readonly Role[],
  required: readonly Role[],
): boolean {
  return required.some((role) => userRoles.includes(role));
}

export function requireRoles(
  userRoles: readonly Role[],
  required: readonly Role[],
): { ok: true } | { ok: false; missing: Role[] } {
  if (hasAnyRole(userRoles, required)) {
    return { ok: true };
  }
  return { ok: false, missing: [...required] };
}

/** Admin may do anything; otherwise require one of the listed roles. */
export function authorize(
  userRoles: readonly Role[],
  required: readonly Role[],
): boolean {
  if (userRoles.includes("admin")) {
    return true;
  }
  return hasAnyRole(userRoles, required);
}
