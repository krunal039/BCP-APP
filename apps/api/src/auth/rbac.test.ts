import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { authorize, hasAnyRole, requireRoles } from "./rbac.js";

describe("rbac", () => {
  it("hasAnyRole matches intersection", () => {
    assert.equal(hasAnyRole(["recipient"], ["sender"]), false);
    assert.equal(hasAnyRole(["sender", "recipient"], ["approver", "sender"]), true);
  });

  it("requireRoles reports missing roles", () => {
    const denied = requireRoles(["recipient"], ["approver"]);
    assert.equal(denied.ok, false);
    if (!denied.ok) {
      assert.deepEqual(denied.missing, ["approver"]);
    }
    assert.equal(requireRoles(["approver"], ["approver"]).ok, true);
  });

  it("authorize lets admin through any gate", () => {
    assert.equal(authorize(["admin"], ["sender"]), true);
    assert.equal(authorize(["admin"], ["approver"]), true);
    assert.equal(authorize(["recipient"], ["sender"]), false);
    assert.equal(authorize(["sender"], ["sender"]), true);
  });
});
