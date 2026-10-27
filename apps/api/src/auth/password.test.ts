import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { hashPassword, validatePasswordPolicy, verifyPassword } from "./password.js";

describe("password policy", () => {
  it("rejects short passwords", () => {
    const result = validatePasswordPolicy("Ab1");
    assert.equal(result.ok, false);
  });

  it("rejects passwords without a number", () => {
    const result = validatePasswordPolicy("abcdefghijkl");
    assert.equal(result.ok, false);
  });

  it("rejects passwords without a letter", () => {
    const result = validatePasswordPolicy("123456789012");
    assert.equal(result.ok, false);
  });

  it("accepts a compliant password", () => {
    const result = validatePasswordPolicy("ChangeMeAdmin1!");
    assert.equal(result.ok, true);
  });
});

describe("password hashing", () => {
  it("hashes with argon2 and verifies", async () => {
    const password = "ChangeMeAdmin1!";
    const hash = await hashPassword(password);
    assert.match(hash, /^\$argon2id\$/);
    assert.equal(await verifyPassword(hash, password), true);
    assert.equal(await verifyPassword(hash, "wrong-password-1"), false);
  });
});
