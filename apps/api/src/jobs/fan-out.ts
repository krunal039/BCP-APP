import type { AlertState, PrismaClient } from "@prisma/client";
import type { DeliveryPort, DeliverySendResult } from "../delivery/port.js";
import { writeAudit } from "../audit/write.js";

/**
 * Apply fan-out send results onto delivery_events and choose alert terminal /
 * in-flight state.
 *
 * - stub: all submitted → completed (no DLR wait)
 * - acs: stay sending while any SMS is submitted (await webhooks);
 *   partial_failure if any send failed; completed if nothing left pending
 */
export function resolveAlertStateAfterFanOut(input: {
  providerKind: DeliveryPort["kind"];
  results: DeliverySendResult[];
}): AlertState {
  const sms = input.results.filter((r) => r.channel === "sms");
  const relevant = sms.length > 0 ? sms : input.results;
  const anyFailed = relevant.some((r) => r.status === "failed");
  const anySubmitted = relevant.some((r) => r.status === "submitted");

  if (input.providerKind === "stub") {
    return anyFailed ? "partial_failure" : "completed";
  }

  // ACS path: wait for delivery reports when submits succeeded.
  if (anyFailed && !anySubmitted) return "partial_failure";
  if (anyFailed && anySubmitted) return "partial_failure";
  if (anySubmitted) return "sending";
  return anyFailed ? "partial_failure" : "completed";
}

export async function applyFanOutResults(
  prisma: PrismaClient,
  input: {
    alertId: string;
    actorUserId: string;
    providerKind: DeliveryPort["kind"];
    results: DeliverySendResult[];
  },
) {
  const finalState = resolveAlertStateAfterFanOut({
    providerKind: input.providerKind,
    results: input.results,
  });

  return prisma.$transaction(async (tx) => {
    await tx.alert.update({
      where: { id: input.alertId },
      data: { state: "sending" },
    });

    for (const r of input.results) {
      await tx.deliveryEvent.updateMany({
        where: {
          alertId: input.alertId,
          channel: r.channel,
          targetAddress: r.address,
        },
        data: {
          status: r.status,
          providerMessageId: r.providerMessageId,
          errorCode: r.errorCode,
        },
      });
    }

    const completed = await tx.alert.update({
      where: { id: input.alertId },
      data: { state: finalState },
    });

    await writeAudit(tx, {
      actorUserId: input.actorUserId,
      alertId: input.alertId,
      action:
        input.providerKind === "acs"
          ? "alert.delivery_acs_enqueued"
          : "alert.delivery_stub_enqueued",
      payload: {
        targetCount: input.results.length,
        provider: input.providerKind,
        submitted: input.results.filter((r) => r.status === "submitted")
          .length,
        failed: input.results.filter((r) => r.status === "failed").length,
        alertState: finalState,
      },
    });

    return completed;
  });
}

/**
 * After a webhook updates recipient rows, roll alert up to
 * completed | partial_failure when no non-terminal SMS remain.
 */
export async function recomputeAlertDeliveryState(
  prisma: PrismaClient,
  alertId: string,
): Promise<AlertState | null> {
  const alert = await prisma.alert.findUnique({ where: { id: alertId } });
  if (!alert) return null;
  if (alert.state !== "sending" && alert.state !== "partial_failure") {
    return alert.state;
  }

  const events = await prisma.deliveryEvent.findMany({
    where: { alertId, channel: "sms" },
    select: { status: true },
  });
  if (events.length === 0) return alert.state;

  const pending = events.some(
    (e) => e.status === "queued" || e.status === "submitted",
  );
  if (pending) {
    // Keep / restore sending while DLRs outstanding (unless already partial).
    if (alert.state === "sending") return "sending";
    return alert.state;
  }

  const anyFailed = events.some((e) => e.status === "failed");
  const next: AlertState = anyFailed ? "partial_failure" : "completed";
  if (next !== alert.state) {
    await prisma.alert.update({
      where: { id: alertId },
      data: { state: next },
    });
  }
  return next;
}
