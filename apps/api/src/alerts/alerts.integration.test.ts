/**
 * Alerts HTTP integration (templates, dual-control, bypass).
 * Skips when DATABASE_URL is unset.
 */
import assert from "node:assert/strict";
import { after, before, describe, it } from "node:test";
import { PrismaClient } from "@prisma/client";
import { buildApp } from "../app.js";
import { loadEnv } from "../env.js";
import { hashPassword } from "../auth/password.js";

const hasDb = Boolean(process.env.DATABASE_URL);

describe("alerts dual-control HTTP", { skip: !hasDb }, () => {
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
  let approverToken = "";
  let bypassToken = "";
  let groupId = "";
  let templateId = "";

  before(async () => {
    app = await buildApp(env);
    await app.ready();

    const hash = await hashPassword("AlertHttpTest1!");

    async function upsertUser(
      username: string,
      roles: Array<"admin" | "sender" | "approver">,
      urgentBypass = false,
    ) {
      const user = await prisma.user.upsert({
        where: { username },
        create: {
          username,
          displayName: username,
          passwordHash: hash,
          urgentBypass,
          roles: { create: roles.map((role) => ({ role })) },
        },
        update: {
          passwordHash: hash,
          urgentBypass,
          failedLoginCount: 0,
          lockedUntil: null,
          tokenVersion: 0,
        },
      });
      for (const role of roles) {
        await prisma.userRole.upsert({
          where: { userId_role: { userId: user.id, role } },
          create: { userId: user.id, role },
          update: {},
        });
      }
      await prisma.user.update({
        where: { id: user.id },
        data: { urgentBypass },
      });
      return user;
    }

    await upsertUser("al_admin", ["admin"]);
    await upsertUser("al_sender", ["sender", "approver"], false);
    await upsertUser("al_approver", ["approver"]);
    await upsertUser("al_bypass", ["sender"], true);

    await prisma.deliveryEvent.deleteMany({
      where: {
        alert: {
          sender: {
            username: { in: ["al_sender", "al_bypass"] },
          },
        },
      },
    });
    await prisma.approval.deleteMany({
      where: {
        alert: { sender: { username: { in: ["al_sender", "al_bypass"] } } },
      },
    });
    await prisma.auditEvent.deleteMany({
      where: {
        actor: {
          username: {
            in: ["al_admin", "al_sender", "al_approver", "al_bypass"],
          },
        },
      },
    });
    await prisma.alert.deleteMany({
      where: {
        sender: { username: { in: ["al_sender", "al_bypass"] } },
      },
    });
    await prisma.groupMember.deleteMany({
      where: { group: { name: "AL Cohort" } },
    });
    await prisma.phone.deleteMany({
      where: { member: { displayName: "AL Worker" } },
    });
    await prisma.member.deleteMany({ where: { displayName: "AL Worker" } });
    await prisma.group.deleteMany({ where: { name: "AL Cohort" } });
    await prisma.template.deleteMany({ where: { name: "AL Template" } });
  });

  after(async () => {
    await prisma.deliveryEvent.deleteMany({
      where: {
        alert: {
          sender: { username: { in: ["al_sender", "al_bypass"] } },
        },
      },
    });
    await prisma.approval.deleteMany({
      where: {
        alert: { sender: { username: { in: ["al_sender", "al_bypass"] } } },
      },
    });
    await prisma.auditEvent.deleteMany({
      where: {
        actor: {
          username: {
            in: ["al_admin", "al_sender", "al_approver", "al_bypass"],
          },
        },
      },
    });
    await prisma.alert.deleteMany({
      where: {
        sender: { username: { in: ["al_sender", "al_bypass"] } },
      },
    });
    await prisma.groupMember.deleteMany({
      where: { group: { name: "AL Cohort" } },
    });
    await prisma.phone.deleteMany({
      where: { member: { displayName: "AL Worker" } },
    });
    await prisma.member.deleteMany({ where: { displayName: "AL Worker" } });
    await prisma.group.deleteMany({ where: { name: "AL Cohort" } });
    await prisma.template.deleteMany({ where: { name: "AL Template" } });
    await prisma.user.deleteMany({
      where: {
        username: {
          in: ["al_admin", "al_sender", "al_approver", "al_bypass"],
        },
      },
    });
    await app.close();
    await prisma.$disconnect();
  });

  async function login(username: string, password = "AlertHttpTest1!") {
    const res = await app.inject({
      method: "POST",
      url: "/auth/login",
      payload: { username, password },
    });
    assert.equal(res.statusCode, 200, res.body);
    return res.json().accessToken as string;
  }

  it("logs in roles", async () => {
    adminToken = await login("al_admin");
    senderToken = await login("al_sender");
    approverToken = await login("al_approver");
    bypassToken = await login("al_bypass");
  });

  it("admin creates template + group + member", async () => {
    const tpl = await app.inject({
      method: "POST",
      url: "/templates",
      headers: { authorization: `Bearer ${adminToken}` },
      payload: {
        name: "AL Template",
        body: "ALERTE BCP — SUIVEZ LES INSTRUCTIONS",
        locale: "fr",
        severity: "critical",
      },
    });
    assert.equal(tpl.statusCode, 201, tpl.body);
    templateId = tpl.json().template.id;

    const group = await app.inject({
      method: "POST",
      url: "/groups",
      headers: { authorization: `Bearer ${adminToken}` },
      payload: { name: "AL Cohort" },
    });
    assert.equal(group.statusCode, 201, group.body);
    groupId = group.json().group.id;

    const member = await app.inject({
      method: "POST",
      url: "/members",
      headers: { authorization: `Bearer ${adminToken}` },
      payload: {
        displayName: "AL Worker",
        e164: "+243922000001",
      },
    });
    assert.equal(member.statusCode, 201, member.body);

    const add = await app.inject({
      method: "POST",
      url: `/groups/${groupId}/members`,
      headers: { authorization: `Bearer ${adminToken}` },
      payload: { memberIds: [member.json().member.id] },
    });
    assert.equal(add.statusCode, 200, add.body);
  });

  it("sender cannot self-approve via HTTP (403)", async () => {
    const created = await app.inject({
      method: "POST",
      url: "/alerts",
      headers: { authorization: `Bearer ${senderToken}` },
      payload: {
        templateId,
        groupIds: [groupId],
        idempotencyKey: "http-self-approve-1",
      },
    });
    assert.equal(created.statusCode, 201, created.body);
    const alertId = created.json().alert.id;
    assert.equal(created.json().alert.state, "pending_approval");

    const self = await app.inject({
      method: "POST",
      url: `/alerts/${alertId}/approve`,
      headers: { authorization: `Bearer ${senderToken}` },
    });
    assert.equal(self.statusCode, 403, self.body);
    assert.match(self.json().message, /must not be the same person/i);
  });

  it("approver approve enqueues stub delivery", async () => {
    app.stubDelivery.clear();
    const created = await app.inject({
      method: "POST",
      url: "/alerts",
      headers: { authorization: `Bearer ${senderToken}` },
      payload: {
        templateId,
        groupIds: [groupId],
        idempotencyKey: "http-approve-ok-1",
      },
    });
    assert.equal(created.statusCode, 201, created.body);
    const alertId = created.json().alert.id;

    const approved = await app.inject({
      method: "POST",
      url: `/alerts/${alertId}/approve`,
      headers: { authorization: `Bearer ${approverToken}` },
    });
    assert.equal(approved.statusCode, 200, approved.body);
    const alert = approved.json().alert;
    assert.equal(alert.state, "completed");
    assert.ok(alert.approverUserId);
    assert.notEqual(alert.approverUserId, alert.senderUserId);
    assert.ok(alert.targetSnapshot?.targets?.length >= 1);
    assert.ok(app.stubDelivery.records.length >= 1);

    const deliveries = await app.inject({
      method: "GET",
      url: `/alerts/${alertId}/deliveries`,
      headers: { authorization: `Bearer ${senderToken}` },
    });
    assert.equal(deliveries.statusCode, 200, deliveries.body);
    assert.ok(deliveries.json().items.length >= 1);
    assert.equal(deliveries.json().items[0].status, "submitted");
  });

  it("urgent bypass without reason is 400", async () => {
    const res = await app.inject({
      method: "POST",
      url: "/alerts/bypass",
      headers: { authorization: `Bearer ${bypassToken}` },
      payload: {
        templateId,
        groupIds: [groupId],
      },
    });
    assert.equal(res.statusCode, 400, res.body);
  });

  it("urgent bypass without capability is 403", async () => {
    const res = await app.inject({
      method: "POST",
      url: "/alerts/bypass",
      headers: { authorization: `Bearer ${senderToken}` },
      payload: {
        templateId,
        groupIds: [groupId],
        reason: "Should not work",
      },
    });
    assert.equal(res.statusCode, 403, res.body);
  });

  it("urgent bypass with reason audits and stubs delivery", async () => {
    app.stubDelivery.clear();
    const res = await app.inject({
      method: "POST",
      url: "/alerts/bypass",
      headers: { authorization: `Bearer ${bypassToken}` },
      payload: {
        templateId,
        groupIds: [groupId],
        reason: "Shaft collapse — send now",
        idempotencyKey: "http-bypass-ok-1",
      },
    });
    assert.equal(res.statusCode, 201, res.body);
    const alert = res.json().alert;
    assert.equal(alert.state, "completed");
    assert.equal(alert.bypassReason, "Shaft collapse — send now");
    assert.equal(alert.approverUserId, null);
    assert.ok(app.stubDelivery.records.length >= 1);

    const audit = await app.inject({
      method: "GET",
      url: `/audit?alertId=${alert.id}&action=alert.bypass`,
      headers: { authorization: `Bearer ${adminToken}` },
    });
    assert.equal(audit.statusCode, 200, audit.body);
    assert.ok(audit.json().items.length >= 1);
    assert.equal(audit.json().items[0].payload.bypass, true);
  });
});
