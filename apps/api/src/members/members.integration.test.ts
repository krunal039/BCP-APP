/**
 * Members / groups integration against live Postgres (DATABASE_URL).
 * Skips when DATABASE_URL is unset.
 */
import assert from "node:assert/strict";
import { after, before, describe, it } from "node:test";
import { PrismaClient } from "@prisma/client";
import { buildApp } from "../app.js";
import { loadEnv } from "../env.js";
import { hashPassword } from "../auth/password.js";

const hasDb = Boolean(process.env.DATABASE_URL);

describe("members/groups integration", { skip: !hasDb }, () => {
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
  let senderToken = "";
  let memberId = "";
  let groupId = "";

  before(async () => {
    app = await buildApp(env);
    await app.ready();

    const adminHash = await hashPassword("MembersAdmin1!");
    const senderHash = await hashPassword("MembersSender1!");

    const admin = await prisma.user.upsert({
      where: { username: "mg_admin" },
      create: {
        username: "mg_admin",
        displayName: "MG Admin",
        passwordHash: adminHash,
        roles: { create: [{ role: "admin" }] },
      },
      update: {
        passwordHash: adminHash,
        failedLoginCount: 0,
        lockedUntil: null,
        tokenVersion: 0,
      },
    });
    await prisma.userRole.upsert({
      where: { userId_role: { userId: admin.id, role: "admin" } },
      create: { userId: admin.id, role: "admin" },
      update: {},
    });

    const sender = await prisma.user.upsert({
      where: { username: "mg_sender" },
      create: {
        username: "mg_sender",
        displayName: "MG Sender",
        passwordHash: senderHash,
        roles: { create: [{ role: "sender" }] },
      },
      update: {
        passwordHash: senderHash,
        failedLoginCount: 0,
        lockedUntil: null,
        tokenVersion: 0,
      },
    });
    await prisma.userRole.upsert({
      where: { userId_role: { userId: sender.id, role: "sender" } },
      create: { userId: sender.id, role: "sender" },
      update: {},
    });

    // Clean directory leftovers from prior runs.
    await prisma.groupMember.deleteMany({});
    await prisma.phone.deleteMany({});
    await prisma.member.deleteMany({});
    await prisma.group.deleteMany({
      where: { name: { in: ["Mine Site A", "Empty Group", "Import Group"] } },
    });
  });

  after(async () => {
    await prisma.groupMember.deleteMany({});
    await prisma.phone.deleteMany({});
    await prisma.member.deleteMany({});
    await prisma.group.deleteMany({
      where: { name: { in: ["Mine Site A", "Empty Group", "Import Group"] } },
    });
    await prisma.user.deleteMany({
      where: { username: { in: ["mg_admin", "mg_sender"] } },
    });
    await app.close();
    await prisma.$disconnect();
  });

  it("logs in admin and sender", async () => {
    const adminLogin = await app.inject({
      method: "POST",
      url: "/auth/login",
      payload: { username: "mg_admin", password: "MembersAdmin1!" },
    });
    assert.equal(adminLogin.statusCode, 200);
    adminToken = adminLogin.json().accessToken;

    const senderLogin = await app.inject({
      method: "POST",
      url: "/auth/login",
      payload: { username: "mg_sender", password: "MembersSender1!" },
    });
    assert.equal(senderLogin.statusCode, 200);
    senderToken = senderLogin.json().accessToken;
  });

  it("rejects invalid E.164 on create", async () => {
    const res = await app.inject({
      method: "POST",
      url: "/members",
      headers: { authorization: `Bearer ${adminToken}` },
      payload: {
        displayName: "Bad Phone",
        e164: "0900000001",
        countryCode: "CD",
      },
    });
    assert.equal(res.statusCode, 400);
  });

  it("admin creates member with DRC default countryCode", async () => {
    const res = await app.inject({
      method: "POST",
      url: "/members",
      headers: { authorization: `Bearer ${adminToken}` },
      payload: {
        displayName: "Jean Mbala",
        e164: "+243900000001",
      },
    });
    assert.equal(res.statusCode, 201, res.body);
    const body = res.json();
    memberId = body.member.id;
    assert.equal(body.member.phones[0].countryCode, "CD");
    assert.equal(body.member.active, true);
    assert.equal(body.member.contactBasis, "employment");
  });

  it("sender cannot create members (403)", async () => {
    const res = await app.inject({
      method: "POST",
      url: "/members",
      headers: { authorization: `Bearer ${senderToken}` },
      payload: {
        displayName: "Nope",
        e164: "+243900000099",
      },
    });
    assert.equal(res.statusCode, 403);
  });

  it("sender can list members", async () => {
    const res = await app.inject({
      method: "GET",
      url: "/members?limit=10",
      headers: { authorization: `Bearer ${senderToken}` },
    });
    assert.equal(res.statusCode, 200);
    const body = res.json();
    assert.ok(body.total >= 1);
    assert.ok(Array.isArray(body.items));
  });

  it("admin creates group and adds member", async () => {
    const create = await app.inject({
      method: "POST",
      url: "/groups",
      headers: { authorization: `Bearer ${adminToken}` },
      payload: { name: "Mine Site A", description: "DRC pilot cohort" },
    });
    assert.equal(create.statusCode, 201, create.body);
    groupId = create.json().group.id;
    assert.equal(create.json().group.sendable, false);

    const add = await app.inject({
      method: "POST",
      url: `/groups/${groupId}/members`,
      headers: { authorization: `Bearer ${adminToken}` },
      payload: { memberIds: [memberId] },
    });
    assert.equal(add.statusCode, 200, add.body);
    assert.equal(add.json().group.memberCount, 1);
    assert.equal(add.json().group.sendable, true);
  });

  it("resolves group phones", async () => {
    const res = await app.inject({
      method: "GET",
      url: `/groups/${groupId}/phones`,
      headers: { authorization: `Bearer ${senderToken}` },
    });
    assert.equal(res.statusCode, 200);
    const body = res.json();
    assert.equal(body.sendable, true);
    assert.equal(body.phones.length, 1);
    assert.equal(body.phones[0].phone.e164, "+243900000001");
  });

  it("empty group is not sendable", async () => {
    const create = await app.inject({
      method: "POST",
      url: "/groups",
      headers: { authorization: `Bearer ${adminToken}` },
      payload: { name: "Empty Group" },
    });
    assert.equal(create.statusCode, 201);
    const emptyId = create.json().group.id;
    const phones = await app.inject({
      method: "GET",
      url: `/groups/${emptyId}/phones`,
      headers: { authorization: `Bearer ${adminToken}` },
    });
    assert.equal(phones.json().sendable, false);
    assert.equal(phones.json().phones.length, 0);
  });

  it("CSV import commits good rows and reports bad ones", async () => {
    const csv = [
      "displayName,e164,countryCode,groupName",
      "Amina Kabila,+243900000002,CD,Import Group",
      "Bad Row,not-a-phone,CD,Import Group",
      "Paul Okito,+243900000003,CD,Import Group",
    ].join("\n");

    const res = await app.inject({
      method: "POST",
      url: "/members/import",
      headers: {
        authorization: `Bearer ${adminToken}`,
        "content-type": "text/csv",
      },
      payload: csv,
    });
    assert.equal(res.statusCode, 200, res.body);
    const body = res.json();
    assert.equal(body.committed, 2);
    assert.equal(body.failed, 1);
    assert.equal(body.errors[0].row, 3);
  });

  it("soft-deactivates member", async () => {
    const res = await app.inject({
      method: "POST",
      url: `/members/${memberId}/deactivate`,
      headers: { authorization: `Bearer ${adminToken}` },
    });
    assert.equal(res.statusCode, 200);
    assert.equal(res.json().member.active, false);
    assert.ok(res.json().member.phones.every((p: { active: boolean }) => !p.active));
  });

  it("removes member from group", async () => {
    // reactivate path not required — remove membership by id still works
    const res = await app.inject({
      method: "DELETE",
      url: `/groups/${groupId}/members/${memberId}`,
      headers: { authorization: `Bearer ${adminToken}` },
    });
    assert.equal(res.statusCode, 200, res.body);
    assert.equal(res.json().group.memberCount, 0);
  });
});
