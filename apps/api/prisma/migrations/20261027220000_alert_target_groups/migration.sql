-- E4: Persist compose-time group targeting + optional idempotency key.
-- Recipient snapshot remains in targetSnapshot (set at approve/bypass).

ALTER TABLE "Alert" ADD COLUMN "targetGroupIds" JSONB NOT NULL DEFAULT '[]';
ALTER TABLE "Alert" ADD COLUMN "idempotencyKey" TEXT;

-- Drop default after backfill so new rows must set targetGroupIds explicitly via app.
ALTER TABLE "Alert" ALTER COLUMN "targetGroupIds" DROP DEFAULT;

CREATE UNIQUE INDEX "Alert_senderUserId_idempotencyKey_key"
  ON "Alert"("senderUserId", "idempotencyKey");
