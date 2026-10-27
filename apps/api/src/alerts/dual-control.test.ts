/**
 * Dual-control + urgent-bypass unit coverage (no HTTP).
 * Requires DATABASE_URL; skips otherwise.
 */
import assert from "node:assert/strict";
import { after, before, describe, it } from "node:test";
import { PrismaClient } from "@prisma/client";
import { hashPassword } from "../auth/password.js";
import { StubDeliveryAdapter } from "../delivery/port.js";
import { AlertService } from "./service.js";

const hasDb = Boolean(process.env.DATABASE_URL);

describe("dual-control alert service", { skip: !hasDb }, () => {
  const prisma = new PrismaClient();
  const stub = new StubDeliveryAdapter();
  const service = new AlertService(prisma, stub);

  let senderId = "";
  let approverId = "";
  let bypassSenderId = "";
  let groupId = "";
  let templateId = "";

  before(async () => {
    const hash = await hashPassword("DualControlTest1!");

    const sender = await prisma.user.upsert({
      where: { username: "dc_sender" },
      create: {
        username: "dc_sender",
        displayName: "DC Sender",
        passwordHash: hash,
        urgentBypass: false,
        roles: { create: [{ role: "sender" }, { role: "approver" }] },
      },
      update: {
        passwordHash: hash,
        urgentBypass: false,
        failedLoginCount: 0,
        lockedUntil: null,
        tokenVersion: 0,
      },
    });
    senderId = sender.id;
    for (const role of ["sender", "approver"] as const) {
      await prisma.userRole.upsert({
        where: { userId_role: { userId: sender.id, role } },
        create: { userId: sender.id, role },
        update: {},
      });
    }

    const approver = await prisma.user.upsert({
      where: { username: "dc_approver" },
      create: {
        username: "dc_approver",
        displayName: "DC Approver",
        passwordHash: hash,
        roles: { create: [{ role: "approver" }] },
      },
      update: {
        passwordHash: hash,
        failedLoginCount: 0,
        lockedUntil: null,
        tokenVersion: 0,
      },
    });
    approverId = approver.id;
    await prisma.userRole.upsert({
      where: { userId_role: { userId: approver.id, role: "approver" } },
      create: { userId: approver.id, role: "approver" },
      update: {},
    });

    const bypassSender = await prisma.user.upsert({
      where: { username: "dc_bypass" },
      create: {
        username: "dc_bypass",
        displayName: "DC Bypass Sender",
        passwordHash: hash,
        urgentBypass: true,
        roles: { create: [{ role: "sender" }] },
      },
      update: {
        passwordHash: hash,
        urgentBypass: true,
        failedLoginCount: 0,
        lockedUntil: null,
        tokenVersion: 0,
      },
    });
    bypassSenderId = bypassSender.id;
    await prisma.userRole.upsert({
      where: { userId_role: { userId: bypassSender.id, role: "sender" } },
      create: { userId: bypassSender.id, role: "sender" },
      update: {},
    });
    await prisma.user.update({
      where: { id: bypassSender.id },
      data: { urgentBypass: true },
    });

    // Clean prior fixtures
    await prisma.deliveryEvent.deleteMany({
      where: { alert: { senderUserId: { in: [senderId, bypassSenderId] } } },
    });
    await prisma.approval.deleteMany({
      where: { alert: { senderUserId: { in: [senderId, bypassSenderId] } } },
    });
    await prisma.auditEvent.deleteMany({
      where: {
        OR: [
          { actorUserId: { in: [senderId, approverId, bypassSenderId] } },
          { alert: { senderUserId: { in: [senderId, bypassSenderId] } } },
        ],
      },
    });
    await prisma.alert.deleteMany({
      where: { senderUserId: { in: [senderId, bypassSenderId] } },
    });
    await prisma.groupMember.deleteMany({
      where: { group: { name: "DC Mine Site" } },
    });
    await prisma.phone.deleteMany({
      where: { member: { displayName: "DC Worker" } },
    });
    await prisma.member.deleteMany({ where: { displayName: "DC Worker" } });
    await prisma.group.deleteMany({ where: { name: "DC Mine Site" } });
    await prisma.template.deleteMany({ where: { name: "DC Evacuation" } });

    const template = await prisma.template.create({
      data: {
        name: "DC Evacuation",
        body: "EVACUER LA ZONE IMMEDIATEMENT",
        locale: "fr",
        severity: "critical",
      },
    });
    templateId = template.id;

    const group = await prisma.group.create({
      data: { name: "DC Mine Site", description: "Dual-control test group" },
    });
    groupId = group.id;

    const member = await prisma.member.create({
      data: {
        displayName: "DC Worker",
        phones: {
          create: { e164: "+243911000001", countryCode: "CD", active: true },
        },
      },
    });
    await prisma.groupMember.create({
      data: { groupId, memberId: member.id },
    });

    stub.clear();
  });

  after(async () => {
    await prisma.deliveryEvent.deleteMany({
      where: { alert: { senderUserId: { in: [senderId, bypassSenderId] } } },
    });
    await prisma.approval.deleteMany({
      where: { alert: { senderUserId: { in: [senderId, bypassSenderId] } } },
    });
    await prisma.auditEvent.deleteMany({
      where: {
        OR: [
          { actorUserId: { in: [senderId, approverId, bypassSenderId] } },
          { alert: { senderUserId: { in: [senderId, bypassSenderId] } } },
        ],
      },
    });
    await prisma.alert.deleteMany({
      where: { senderUserId: { in: [senderId, bypassSenderId] } },
    });
    await prisma.groupMember.deleteMany({
      where: { group: { name: "DC Mine Site" } },
    });
    await prisma.phone.deleteMany({
      where: { member: { displayName: "DC Worker" } },
    });
    await prisma.member.deleteMany({ where: { displayName: "DC Worker" } });
    await prisma.group.deleteMany({ where: { name: "DC Mine Site" } });
    await prisma.template.deleteMany({ where: { name: "DC Evacuation" } });
    await prisma.user.deleteMany({
      where: { username: { in: ["dc_sender", "dc_approver", "dc_bypass"] } },
    });
    await prisma.$disconnect();
  });

  it("compose submits to pending_approval", async () => {
    const result = await service.compose(
      { id: senderId, roles: ["sender", "approver"], urgentBypass: false },
      {
        templateId,
        groupIds: [groupId],
        submitForApproval: true,
        idempotencyKey: "dc-compose-1-unique-key",
      },
    );
    assert.equal(result.ok, true);
    if (!result.ok) return;
    assert.equal(result.alert.state, "pending_approval");
    assert.equal(result.alert.senderUserId, senderId);
    assert.deepEqual(result.alert.targetGroupIds, [groupId]);
  });

  it("rejects self-approval (Approver ≠ Sender)", async () => {
    const composed = await service.compose(
      { id: senderId, roles: ["sender", "approver"], urgentBypass: false },
      {
        templateId,
        groupIds: [groupId],
        idempotencyKey: "dc-self-approve-key",
      },
    );
    assert.equal(composed.ok, true);
    if (!composed.ok) return;

    const self = await service.approve(
      { id: senderId, roles: ["sender", "approver"], urgentBypass: false },
      composed.alert.id,
    );
    assert.equal(self.ok, false);
    if (self.ok) return;
    assert.equal(self.statusCode, 403);
    assert.match(self.message, /must not be the same person/i);
  });

  it("allows different approver and snapshots recipients via stub delivery", async () => {
    stub.clear();
    const composed = await service.compose(
      { id: senderId, roles: ["sender"], urgentBypass: false },
      {
        templateId,
        groupIds: [groupId],
        idempotencyKey: "dc-approve-ok-key",
      },
    );
    assert.equal(composed.ok, true);
    if (!composed.ok) return;

    const approved = await service.approve(
      { id: approverId, roles: ["approver"], urgentBypass: false },
      composed.alert.id,
    );
    assert.equal(approved.ok, true);
    if (!approved.ok) return;
    assert.equal(approved.alert.approverUserId, approverId);
    assert.equal(approved.alert.state, "completed");
    assert.ok(approved.alert.targetSnapshot);
    assert.ok(
      approved.alert.targetSnapshot!.targets.some(
        (t) => t.channel === "sms" && t.address === "+243911000001",
      ),
    );
    assert.ok(stub.records.length >= 1);
    assert.ok(stub.records.every((r) => r.alertId === composed.alert.id));

    const audits = await prisma.auditEvent.findMany({
      where: { alertId: composed.alert.id, action: "alert.approve" },
    });
    assert.equal(audits.length, 1);
    const payload = audits[0]!.payload as { bypass?: boolean };
    assert.equal(payload.bypass, false);
  });

  it("reject requires Approver ≠ Sender and writes audit", async () => {
    const composed = await service.compose(
      { id: senderId, roles: ["sender"], urgentBypass: false },
      {
        templateId,
        groupIds: [groupId],
        idempotencyKey: "dc-reject-key",
      },
    );
    assert.equal(composed.ok, true);
    if (!composed.ok) return;

    const selfReject = await service.reject(
      { id: senderId, roles: ["approver"], urgentBypass: false },
      composed.alert.id,
      { note: "nope" },
    );
    assert.equal(selfReject.ok, false);
    if (selfReject.ok) return;
    assert.equal(selfReject.statusCode, 403);

    const rejected = await service.reject(
      { id: approverId, roles: ["approver"], urgentBypass: false },
      composed.alert.id,
      { note: "Not a real incident" },
    );
    assert.equal(rejected.ok, true);
    if (!rejected.ok) return;
    assert.equal(rejected.alert.state, "rejected");
    assert.equal(rejected.alert.rejectNote, "Not a real incident");

    const audits = await prisma.auditEvent.findMany({
      where: { alertId: composed.alert.id, action: "alert.reject" },
    });
    assert.equal(audits.length, 1);
  });

  it("urgent bypass requires reason", async () => {
    const composed = await service.compose(
      { id: bypassSenderId, roles: ["sender"], urgentBypass: true },
      {
        templateId,
        groupIds: [groupId],
        submitForApproval: false,
        idempotencyKey: "dc-bypass-no-reason",
      },
    );
    assert.equal(composed.ok, true);
    if (!composed.ok) return;

    const missing = await service.bypass(
      { id: bypassSenderId, roles: ["sender"], urgentBypass: true },
      composed.alert.id,
      {},
    );
    assert.equal(missing.ok, false);
    if (missing.ok) return;
    assert.equal(missing.statusCode, 400);
  });

  it("urgent bypass requires capability", async () => {
    const composed = await service.compose(
      { id: senderId, roles: ["sender"], urgentBypass: false },
      {
        templateId,
        groupIds: [groupId],
        submitForApproval: false,
        idempotencyKey: "dc-bypass-no-cap",
      },
    );
    assert.equal(composed.ok, true);
    if (!composed.ok) return;

    const denied = await service.bypass(
      { id: senderId, roles: ["sender"], urgentBypass: false },
      composed.alert.id,
      { reason: "Site fire — evacuate now" },
    );
    assert.equal(denied.ok, false);
    if (denied.ok) return;
    assert.equal(denied.statusCode, 403);
  });

  it("urgent bypass with reason snapshots + audits bypass=true", async () => {
    stub.clear();
    const composed = await service.compose(
      { id: bypassSenderId, roles: ["sender"], urgentBypass: true },
      {
        templateId,
        groupIds: [groupId],
        submitForApproval: false,
        idempotencyKey: "dc-bypass-ok",
      },
    );
    assert.equal(composed.ok, true);
    if (!composed.ok) return;
    assert.equal(composed.alert.state, "draft");

    const bypassed = await service.bypass(
      { id: bypassSenderId, roles: ["sender"], urgentBypass: true },
      composed.alert.id,
      { reason: "Active fire at shaft 3 — immediate send" },
    );
    assert.equal(bypassed.ok, true);
    if (!bypassed.ok) return;
    assert.equal(bypassed.alert.state, "completed");
    assert.equal(
      bypassed.alert.bypassReason,
      "Active fire at shaft 3 — immediate send",
    );
    assert.equal(bypassed.alert.approverUserId, null);
    assert.ok(bypassed.alert.targetSnapshot);
    assert.ok(stub.records.some((r) => r.channel === "sms"));

    const audits = await prisma.auditEvent.findMany({
      where: { alertId: composed.alert.id, action: "alert.bypass" },
    });
    assert.equal(audits.length, 1);
    const payload = audits[0]!.payload as {
      bypass?: boolean;
      bypassReason?: string;
    };
    assert.equal(payload.bypass, true);
    assert.equal(
      payload.bypassReason,
      "Active fire at shaft 3 — immediate send",
    );
  });

  it("membership change after snapshot does not alter in-flight targets", async () => {
    stub.clear();
    const composed = await service.compose(
      { id: senderId, roles: ["sender"], urgentBypass: false },
      {
        templateId,
        groupIds: [groupId],
        idempotencyKey: "dc-snapshot-immutable",
      },
    );
    assert.equal(composed.ok, true);
    if (!composed.ok) return;

    const approved = await service.approve(
      { id: approverId, roles: ["approver"], urgentBypass: false },
      composed.alert.id,
    );
    assert.equal(approved.ok, true);
    if (!approved.ok) return;
    const snapCount = approved.alert.targetSnapshot!.targets.length;

    // Add another member after send — snapshot must stay frozen.
    const late = await prisma.member.create({
      data: {
        displayName: "DC Late Joiner",
        phones: {
          create: { e164: "+243911000099", countryCode: "CD" },
        },
      },
    });
    await prisma.groupMember.create({
      data: { groupId, memberId: late.id },
    });

    const again = await service.getById(composed.alert.id);
    assert.equal(again.ok, true);
    if (!again.ok) return;
    assert.equal(again.alert.targetSnapshot!.targets.length, snapCount);
    assert.ok(
      !again.alert.targetSnapshot!.targets.some(
        (t) => t.address === "+243911000099",
      ),
    );

    await prisma.groupMember.delete({
      where: { groupId_memberId: { groupId, memberId: late.id } },
    });
    await prisma.phone.deleteMany({ where: { memberId: late.id } });
    await prisma.member.delete({ where: { id: late.id } });
  });
});
