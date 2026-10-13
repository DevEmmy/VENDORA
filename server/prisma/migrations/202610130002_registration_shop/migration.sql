-- Nullable columns preserve existing accounts and operator-provisioned shops.
ALTER TABLE "vendora"."users" ADD COLUMN "name" TEXT;
ALTER TABLE "vendora"."businesses"
  ADD COLUMN "businessName" TEXT,
  ADD COLUMN "businessType" TEXT,
  ADD COLUMN "city" TEXT;
