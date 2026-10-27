/**
 * Integration smoke against a live Postgres (DATABASE_URL).
 * Skips automatically when DATABASE_URL is unset so CI build stays green
 * without a database service. Local/dev: migrate + seed first, then:
 *   pnpm --filter @bcp/api test:integration
 */
import assert from "node:assert/strict";
import { after, before, describe, it } from "node:test";
import { PrismaClient } from "@prisma/client";
import { buildApp } from "../app.js";
import { loadEnv } from "../env.js";
import { hashPassword } from "./password.js";

const hasDb = Boolean(process.env.DATABASE_URL);

describe("auth integration", { skip: !hasDb }, () => {
  const prisma = new PrismaClient();
  const env = loadEnv({
    ...process.env,
    NODE_ENV: "test",
    LOG_LEVEL: "silent",
    JWT_SECRET: "test-jwt-secret-at-least-32-characters-long",
    JWT_EXPIRES_IN: "1h",
  });

  let app: Awaited<ReturnType<typeof buildApp>>;
  let adminToken = "";
  let senderId = "";
  let senderToken = "";

  before(async () => {
    app = await buildApp(env);
    await app.ready();

    const passwordHash = await hashPassword("IntegrationAdmin1!");
    const admin = await prisma.user.upsert({
      where: { username: "it_admin" },
      create: {
        username: "it_admin",
        displayName: "IT Admin",
        passwordHash,
        roles: { create: [{ role: "admin" }] },
      },
      update: {
        passwordHash,
        failedLoginCount: 0,
        lockedUntil: null,
        tokenVersion: 0,
      },
    });
    // Ensure admin role exists after upsert update path.
    await prisma.userRole.upsert({
      where: { userId_role: { userId: admin.id, role: "admin" } },
      create: { userId: admin.id, role: "admin" },
      update: {},
    });
  });

  after(async () => {
    await app.close();
    await prisma.user.deleteMany({
      where: { username: { in: ["it_admin", "it_sender", "it_recipient"] } },
    });
    await prisma.$disconnect();
  });

  it("logs in admin and returns JWT", async () => {
    const res = await app.inject({
      method: "POST",
      url: "/auth/login",
      payload: { username: "it_admin", password: "IntegrationAdmin1!" },
    });
    assert.equal(res.statusCode, 200);
    const body = res.json();
    assert.ok(body.accessToken);
    assert.equal(body.tokenType, "Bearer");
    assert.ok(body.user.roles.includes("admin"));
    adminToken = body.accessToken;
  });

  it("rejects bad credentials with 401", async () => {
    const res = await app.inject({
      method: "POST",
      url: "/auth/login",
      payload: { username: "it_admin", password: "WrongPassword1!" },
    });
    assert.equal(res.statusCode, 401);
  });

  it("admin can create a sender user", async () => {
    const res = await app.inject({
      method: "POST",
      url: "/users",
      headers: { authorization: `Bearer ${adminToken}` },
      payload: {
        username: "it_sender",
        password: "SenderPass1234",
        displayName: "IT Sender",
        roles: ["sender"],
        urgentBypass: false,
      },
    });
    assert.equal(res.statusCode, 201, res.body);
    const body = res.json();
    senderId = body.user.id;
    assert.deepEqual(body.user.roles, ["sender"]);
  });

  it("sender can login and hit sender route but not approver/admin", async () => {
    const login = await app.inject({
      method: "POST",
      url: "/auth/login",
      payload: { username: "it_sender", password: "SenderPass1234" },
    });
    assert.equal(login.statusCode, 200);
    senderToken = login.json().accessToken;

    const senderOk = await app.inject({
      method: "GET",
      url: "/rbac/sender",
      headers: { authorization: `Bearer ${senderToken}` },
    });
    assert.equal(senderOk.statusCode, 200);

    const approverDenied = await app.inject({
      method: "GET",
      url: "/rbac/approver",
      headers: { authorization: `Bearer ${senderToken}` },
    });
    assert.equal(approverDenied.statusCode, 403);

    const adminDenied = await app.inject({
      method: "GET",
      url: "/rbac/admin",
      headers: { authorization: `Bearer ${senderToken}` },
    });
    assert.equal(adminDenied.statusCode, 403);
  });

  it("admin can assign approver role and revoke prior tokens", async () => {
    const patch = await app.inject({
      method: "PATCH",
      url: `/users/${senderId}/roles`,
      headers: { authorization: `Bearer ${adminToken}` },
      payload: { roles: ["sender", "approver"], urgentBypass: false },
    });
    assert.equal(patch.statusCode, 200, patch.body);
    assert.ok(patch.json().user.roles.includes("approver"));

    const revoked = await app.inject({
      method: "GET",
      url: "/auth/me",
      headers: { authorization: `Bearer ${senderToken}` },
    });
    assert.equal(revoked.statusCode, 401);

    const relogin = await app.inject({
      method: "POST",
      url: "/auth/login",
      payload: { username: "it_sender", password: "SenderPass1234" },
    });
    assert.equal(relogin.statusCode, 200);
    senderToken = relogin.json().accessToken;

    const approverOk = await app.inject({
      method: "GET",
      url: "/rbac/approver",
      headers: { authorization: `Bearer ${senderToken}` },
    });
    assert.equal(approverOk.statusCode, 200);
  });

  it("logout invalidates the current JWT", async () => {
    const logout = await app.inject({
      method: "POST",
      url: "/auth/logout",
      headers: { authorization: `Bearer ${senderToken}` },
    });
    assert.equal(logout.statusCode, 200);

    const me = await app.inject({
      method: "GET",
      url: "/auth/me",
      headers: { authorization: `Bearer ${senderToken}` },
    });
    assert.equal(me.statusCode, 401);
  });

  it("recipient cannot create users", async () => {
    const passwordHash = await hashPassword("RecipientPass1");
    const recipient = await prisma.user.upsert({
      where: { username: "it_recipient" },
      create: {
        username: "it_recipient",
        displayName: "IT Recipient",
        passwordHash,
        roles: { create: [{ role: "recipient" }] },
      },
      update: { passwordHash, tokenVersion: 0 },
    });
    await prisma.userRole.upsert({
      where: { userId_role: { userId: recipient.id, role: "recipient" } },
      create: { userId: recipient.id, role: "recipient" },
      update: {},
    });

    const login = await app.inject({
      method: "POST",
      url: "/auth/login",
      payload: { username: "it_recipient", password: "RecipientPass1" },
    });
    assert.equal(login.statusCode, 200);
    const token = login.json().accessToken;

    const create = await app.inject({
      method: "POST",
      url: "/users",
      headers: { authorization: `Bearer ${token}` },
      payload: {
        username: "should_fail",
        password: "ShouldFail1234",
        displayName: "Nope",
        roles: ["recipient"],
      },
    });
    assert.equal(create.statusCode, 403);
  });
});
