-- CreateSchema
CREATE SCHEMA IF NOT EXISTS "vendora";
REVOKE ALL ON SCHEMA "vendora" FROM PUBLIC;

-- CreateTable
CREATE TABLE "vendora"."users" (
    "id" UUID NOT NULL,
    "phone" TEXT NOT NULL,
    "passwordHash" TEXT NOT NULL,
    "phoneVerifiedAt" TIMESTAMP(3),
    "status" TEXT NOT NULL DEFAULT 'pending',
    "authVersion" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "recoveryDestination" TEXT,
    "recoveryVerifiedAt" TIMESTAMP(3),

    CONSTRAINT "users_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "vendora"."businesses" (
    "id" UUID NOT NULL,
    "phone" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "whatsappLinkedAt" TIMESTAMP(3),

    CONSTRAINT "businesses_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "vendora"."business_memberships" (
    "id" UUID NOT NULL,
    "userId" UUID NOT NULL,
    "businessId" UUID NOT NULL,
    "role" TEXT NOT NULL,
    "permissions" TEXT[],
    "status" TEXT NOT NULL DEFAULT 'active',

    CONSTRAINT "business_memberships_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "vendora"."sessions" (
    "id" UUID NOT NULL,
    "userId" UUID NOT NULL,
    "csrf" TEXT NOT NULL,
    "authVersion" INTEGER NOT NULL,
    "authenticatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "lastActivityAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "idleExpiresAt" TIMESTAMP(3) NOT NULL,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "revokedAt" TIMESTAMP(3),
    "mfaLevel" INTEGER NOT NULL DEFAULT 0,

    CONSTRAINT "sessions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "vendora"."refresh_tokens" (
    "digest" TEXT NOT NULL,
    "sessionId" UUID NOT NULL,
    "parentDigest" TEXT,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "consumedAt" TIMESTAMP(3),

    CONSTRAINT "refresh_tokens_pkey" PRIMARY KEY ("digest")
);

-- CreateTable
CREATE TABLE "vendora"."verification_challenges" (
    "id" UUID NOT NULL,
    "userId" UUID NOT NULL,
    "destination" TEXT NOT NULL,
    "purpose" TEXT NOT NULL,
    "digest" TEXT NOT NULL,
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "consumedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "verification_challenges_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "vendora"."recovery_tokens" (
    "digest" TEXT NOT NULL,
    "userId" UUID NOT NULL,
    "purpose" TEXT NOT NULL,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "consumedAt" TIMESTAMP(3),

    CONSTRAINT "recovery_tokens_pkey" PRIMARY KEY ("digest")
);

-- CreateTable
CREATE TABLE "vendora"."pre_auth" (
    "digest" TEXT NOT NULL,
    "csrf" TEXT NOT NULL,
    "expiresAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "pre_auth_pkey" PRIMARY KEY ("digest")
);

-- CreateTable
CREATE TABLE "vendora"."resource_ownership" (
    "kind" TEXT NOT NULL,
    "resourceId" TEXT NOT NULL,
    "businessId" UUID NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "resource_ownership_pkey" PRIMARY KEY ("kind","resourceId")
);

-- CreateTable
CREATE TABLE "vendora"."auth_audit_events" (
    "id" UUID NOT NULL,
    "action" TEXT NOT NULL,
    "outcome" TEXT NOT NULL,
    "userId" UUID,
    "sessionId" UUID,
    "requestId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "auth_audit_events_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "vendora"."webhook_events" (
    "id" TEXT NOT NULL,
    "provider" TEXT NOT NULL,
    "payload" JSONB NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "processedAt" TIMESTAMP(3),

    CONSTRAINT "webhook_events_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "vendora"."business_snapshots" (
    "businessId" UUID NOT NULL,
    "state" JSONB NOT NULL,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "business_snapshots_pkey" PRIMARY KEY ("businessId")
);

-- CreateTable
CREATE TABLE "vendora"."submissions" (
    "id" UUID NOT NULL,
    "businessId" UUID NOT NULL,
    "metadata" JSONB NOT NULL,
    "file" BYTEA NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "submissions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "vendora"."delivery_jobs" (
    "id" UUID NOT NULL,
    "ciphertext" TEXT NOT NULL,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "leaseUntil" TIMESTAMP(3),
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "delivery_jobs_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "vendora"."channel_entries" (
    "seq" SERIAL NOT NULL,
    "businessId" UUID NOT NULL,
    "phone" TEXT NOT NULL,
    "source" TEXT NOT NULL,
    "text" TEXT,
    "op" JSONB NOT NULL,
    "at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "channel_entries_pkey" PRIMARY KEY ("seq")
);

-- CreateIndex
CREATE UNIQUE INDEX "users_phone_key" ON "vendora"."users"("phone");

-- CreateIndex
CREATE UNIQUE INDEX "businesses_phone_key" ON "vendora"."businesses"("phone");

-- CreateIndex
CREATE INDEX "business_memberships_businessId_status_idx" ON "vendora"."business_memberships"("businessId", "status");

-- CreateIndex
CREATE UNIQUE INDEX "business_memberships_userId_businessId_key" ON "vendora"."business_memberships"("userId", "businessId");

-- CreateIndex
CREATE INDEX "sessions_userId_revokedAt_idx" ON "vendora"."sessions"("userId", "revokedAt");

-- CreateIndex
CREATE INDEX "sessions_expiresAt_idx" ON "vendora"."sessions"("expiresAt");

-- CreateIndex
CREATE UNIQUE INDEX "refresh_tokens_parentDigest_key" ON "vendora"."refresh_tokens"("parentDigest");

-- CreateIndex
CREATE INDEX "refresh_tokens_sessionId_idx" ON "vendora"."refresh_tokens"("sessionId");

-- CreateIndex
CREATE INDEX "refresh_tokens_expiresAt_idx" ON "vendora"."refresh_tokens"("expiresAt");

-- CreateIndex
CREATE INDEX "verification_challenges_userId_purpose_createdAt_idx" ON "vendora"."verification_challenges"("userId", "purpose", "createdAt");

-- CreateIndex
CREATE INDEX "verification_challenges_expiresAt_idx" ON "vendora"."verification_challenges"("expiresAt");

-- CreateIndex
CREATE INDEX "recovery_tokens_userId_purpose_idx" ON "vendora"."recovery_tokens"("userId", "purpose");

-- CreateIndex
CREATE INDEX "recovery_tokens_expiresAt_idx" ON "vendora"."recovery_tokens"("expiresAt");

-- CreateIndex
CREATE INDEX "pre_auth_expiresAt_idx" ON "vendora"."pre_auth"("expiresAt");

-- CreateIndex
CREATE INDEX "resource_ownership_businessId_kind_idx" ON "vendora"."resource_ownership"("businessId", "kind");

-- CreateIndex
CREATE INDEX "auth_audit_events_userId_createdAt_idx" ON "vendora"."auth_audit_events"("userId", "createdAt");

-- CreateIndex
CREATE INDEX "webhook_events_processedAt_createdAt_idx" ON "vendora"."webhook_events"("processedAt", "createdAt");

-- CreateIndex
CREATE INDEX "submissions_businessId_createdAt_idx" ON "vendora"."submissions"("businessId", "createdAt");

-- CreateIndex
CREATE INDEX "delivery_jobs_leaseUntil_expiresAt_idx" ON "vendora"."delivery_jobs"("leaseUntil", "expiresAt");

-- CreateIndex
CREATE INDEX "channel_entries_businessId_seq_idx" ON "vendora"."channel_entries"("businessId", "seq");

-- AddForeignKey
ALTER TABLE "vendora"."business_memberships" ADD CONSTRAINT "business_memberships_userId_fkey" FOREIGN KEY ("userId") REFERENCES "vendora"."users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "vendora"."business_memberships" ADD CONSTRAINT "business_memberships_businessId_fkey" FOREIGN KEY ("businessId") REFERENCES "vendora"."businesses"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "vendora"."sessions" ADD CONSTRAINT "sessions_userId_fkey" FOREIGN KEY ("userId") REFERENCES "vendora"."users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "vendora"."refresh_tokens" ADD CONSTRAINT "refresh_tokens_sessionId_fkey" FOREIGN KEY ("sessionId") REFERENCES "vendora"."sessions"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "vendora"."refresh_tokens" ADD CONSTRAINT "refresh_tokens_parentDigest_fkey" FOREIGN KEY ("parentDigest") REFERENCES "vendora"."refresh_tokens"("digest") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "vendora"."verification_challenges" ADD CONSTRAINT "verification_challenges_userId_fkey" FOREIGN KEY ("userId") REFERENCES "vendora"."users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "vendora"."recovery_tokens" ADD CONSTRAINT "recovery_tokens_userId_fkey" FOREIGN KEY ("userId") REFERENCES "vendora"."users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "vendora"."resource_ownership" ADD CONSTRAINT "resource_ownership_businessId_fkey" FOREIGN KEY ("businessId") REFERENCES "vendora"."businesses"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "vendora"."business_snapshots" ADD CONSTRAINT "business_snapshots_businessId_fkey" FOREIGN KEY ("businessId") REFERENCES "vendora"."businesses"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "vendora"."submissions" ADD CONSTRAINT "submissions_businessId_fkey" FOREIGN KEY ("businessId") REFERENCES "vendora"."businesses"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "vendora"."channel_entries" ADD CONSTRAINT "channel_entries_businessId_fkey" FOREIGN KEY ("businessId") REFERENCES "vendora"."businesses"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- Supabase projects may have broad inherited defaults. This schema is backend-only.
REVOKE ALL ON ALL TABLES IN SCHEMA vendora FROM PUBLIC;
REVOKE ALL ON ALL SEQUENCES IN SCHEMA vendora FROM PUBLIC;
DO $$
DECLARE role_name text;
BEGIN
  FOREACH role_name IN ARRAY ARRAY['anon', 'authenticated'] LOOP
    IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = role_name) THEN
      EXECUTE format('REVOKE ALL ON SCHEMA vendora FROM %I', role_name);
      EXECUTE format('REVOKE ALL ON ALL TABLES IN SCHEMA vendora FROM %I', role_name);
      EXECUTE format('REVOKE ALL ON ALL SEQUENCES IN SCHEMA vendora FROM %I', role_name);
    END IF;
  END LOOP;
END $$;
