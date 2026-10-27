-- E3: Directory members (separate from auth users), retarget phones + group membership.

-- CreateEnum
CREATE TYPE "ContactBasis" AS ENUM ('employment', 'consent', 'other');

-- CreateTable
CREATE TABLE "Member" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "displayName" TEXT NOT NULL,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "contactBasis" "ContactBasis" NOT NULL DEFAULT 'employment',
    "contactBasisAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "userId" UUID,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Member_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "Member_userId_key" ON "Member"("userId");

-- CreateIndex
CREATE INDEX "Member_active_idx" ON "Member"("active");

-- CreateIndex
CREATE INDEX "Member_displayName_idx" ON "Member"("displayName");

-- AddForeignKey
ALTER TABLE "Member" ADD CONSTRAINT "Member_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- Drop legacy Phone / GroupMember (tied to User; unused before E3).
DROP TABLE IF EXISTS "Phone";
DROP TABLE IF EXISTS "GroupMember";

-- Recreate Phone against Member
CREATE TABLE "Phone" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "memberId" UUID NOT NULL,
    "e164" TEXT NOT NULL,
    "countryCode" CHAR(2) NOT NULL DEFAULT 'CD',
    "active" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Phone_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "Phone_memberId_e164_key" ON "Phone"("memberId", "e164");
CREATE INDEX "Phone_countryCode_idx" ON "Phone"("countryCode");
CREATE INDEX "Phone_e164_idx" ON "Phone"("e164");
CREATE INDEX "Phone_active_idx" ON "Phone"("active");

ALTER TABLE "Phone" ADD CONSTRAINT "Phone_memberId_fkey" FOREIGN KEY ("memberId") REFERENCES "Member"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- Recreate GroupMember against Member
CREATE TABLE "GroupMember" (
    "groupId" UUID NOT NULL,
    "memberId" UUID NOT NULL,

    CONSTRAINT "GroupMember_pkey" PRIMARY KEY ("groupId","memberId")
);

CREATE INDEX "GroupMember_memberId_idx" ON "GroupMember"("memberId");

ALTER TABLE "GroupMember" ADD CONSTRAINT "GroupMember_groupId_fkey" FOREIGN KEY ("groupId") REFERENCES "Group"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "GroupMember" ADD CONSTRAINT "GroupMember_memberId_fkey" FOREIGN KEY ("memberId") REFERENCES "Member"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- Group name index for list/search at scale
CREATE INDEX IF NOT EXISTS "Group_name_idx" ON "Group"("name");
