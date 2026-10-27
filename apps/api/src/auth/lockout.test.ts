import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  isAccountLocked,
  LOCKOUT_DURATION_MS,
  MAX_FAILED_LOGINS,
  nextFailedLoginState,
} from "./lockout.js";

describe("lockout", () => {
  it("does not lock before threshold", () => {
    const next = nextFailedLoginState(MAX_FAILED_LOGINS - 2);
    assert.equal(next.failedLoginCount, MAX_FAILED_LOGINS - 1);
    assert.equal(next.lockedUntil, null);
  });

  it("locks at threshold", () => {
    const now = new Date("2026-10-27T12:00:00.000Z");
    const next = nextFailedLoginState(MAX_FAILED_LOGINS - 1, now);
    assert.equal(next.failedLoginCount, MAX_FAILED_LOGINS);
    assert.ok(next.lockedUntil);
    assert.equal(
      next.lockedUntil!.getTime(),
      now.getTime() + LOCKOUT_DURATION_MS,
    );
  });

  it("detects active lock", () => {
    const now = new Date("2026-10-27T12:00:00.000Z");
    const until = new Date(now.getTime() + 60_000);
    assert.equal(isAccountLocked(until, now), true);
    assert.equal(isAccountLocked(until, new Date(until.getTime() + 1)), false);
    assert.equal(isAccountLocked(null, now), false);
  });
});
