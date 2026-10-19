BEGIN;
ALTER TABLE vendora.businesses
  ADD COLUMN inventory_migrated_at TIMESTAMPTZ(3),
  ADD COLUMN inventory_migration_report JSONB;

-- Last line of protection for old workers and stale clients, serialized against
-- cutover by the same business row lock as every live inventory mutation.
CREATE FUNCTION vendora.protect_relational_snapshot() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE owner_id uuid; mode vendora.inventory_mode;
BEGIN
  owner_id := CASE WHEN TG_OP='DELETE' THEN OLD."businessId" ELSE NEW."businessId" END;
  SELECT inventory_mode INTO mode FROM vendora.businesses WHERE id=owner_id FOR UPDATE;
  IF mode='RELATIONAL' THEN
    RAISE EXCEPTION 'Relational business snapshot is a read-only rollback copy' USING ERRCODE='23514';
  END IF;
  IF TG_OP='DELETE' THEN RETURN OLD; END IF;
  IF TG_OP='UPDATE' AND OLD."businessId" IS DISTINCT FROM NEW."businessId" THEN
    RAISE EXCEPTION 'Snapshot business cannot be changed' USING ERRCODE='23514';
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER business_snapshots_cutover_readonly BEFORE INSERT OR UPDATE OR DELETE
  ON vendora.business_snapshots FOR EACH ROW EXECUTE FUNCTION vendora.protect_relational_snapshot();
COMMIT;
