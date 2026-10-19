-- Additive foundation only. Existing shops stay SNAPSHOT until explicit backfill.
-- Decimal(12,3) cannot represent every Int32 value. Refuse an unsafe conversion
-- before changing anything; operators must reconcile these rows, never truncate.
DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM vendora.products WHERE stock_qty > 999999999 OR low_stock_at > 999999999)
     OR EXISTS (SELECT 1 FROM vendora.sale_items WHERE quantity > 999999999) THEN
    RAISE EXCEPTION 'Quantity exceeds Decimal(12,3) capacity; reconcile before migration';
  END IF;
END $$;

-- Keep the preflight outside the explicit DDL transaction so Prisma can report
-- its original exception instead of a subsequent "transaction aborted" error.
BEGIN;

CREATE TYPE vendora.inventory_mode AS ENUM ('SNAPSHOT', 'RELATIONAL');
CREATE TYPE vendora.sale_status AS ENUM ('COMPLETED', 'REVERSED');
CREATE TYPE vendora.stock_movement_type AS ENUM ('OPENING', 'RESTOCK', 'SALE', 'SALE_REVERSAL', 'COUNT_CORRECTION', 'LEGACY_ADJUSTMENT');

ALTER TABLE vendora.businesses
  ADD COLUMN inventory_mode vendora.inventory_mode NOT NULL DEFAULT 'SNAPSHOT',
  ADD COLUMN sync_seq BIGINT NOT NULL DEFAULT 0 CHECK (sync_seq >= 0);

ALTER TABLE vendora.products
  ALTER COLUMN stock_qty TYPE NUMERIC(12,3) USING stock_qty::numeric(12,3),
  ALTER COLUMN low_stock_at TYPE NUMERIC(12,3) USING low_stock_at::numeric(12,3),
  ADD COLUMN unit TEXT NOT NULL DEFAULT 'piece',
  ADD COLUMN aliases TEXT[] NOT NULL DEFAULT ARRAY[]::text[],
  ADD COLUMN client_id UUID,
  ADD COLUMN legacy_id TEXT,
  ADD COLUMN created_by_id UUID REFERENCES vendora.users(id) ON DELETE RESTRICT ON UPDATE CASCADE,
  ADD COLUMN updated_at TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  ADD COLUMN deleted_at TIMESTAMPTZ(3),
  ADD COLUMN sync_seq BIGINT NOT NULL DEFAULT 0 CHECK (sync_seq >= 0),
  ADD CONSTRAINT products_business_id_client_id_key UNIQUE (business_id,client_id),
  ADD CONSTRAINT products_business_id_legacy_id_key UNIQUE (business_id,legacy_id);
CREATE INDEX products_business_id_sync_seq_idx ON vendora.products(business_id,sync_seq);

ALTER TABLE vendora.sale_items ALTER COLUMN quantity TYPE NUMERIC(12,3) USING quantity::numeric(12,3);

ALTER TABLE vendora.sales
  ADD COLUMN client_id UUID,
  ADD COLUMN legacy_id TEXT,
  ADD COLUMN created_by_id UUID REFERENCES vendora.users(id) ON DELETE RESTRICT ON UPDATE CASCADE,
  ADD COLUMN status vendora.sale_status NOT NULL DEFAULT 'COMPLETED',
  ADD COLUMN reversed_sale_id UUID,
  ADD COLUMN source TEXT NOT NULL DEFAULT 'app',
  ADD COLUMN metadata JSONB NOT NULL DEFAULT '{}',
  ADD COLUMN updated_at TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  ADD COLUMN deleted_at TIMESTAMPTZ(3),
  ADD COLUMN sync_seq BIGINT NOT NULL DEFAULT 0 CHECK (sync_seq >= 0),
  ADD CONSTRAINT sales_business_id_client_id_key UNIQUE (business_id,client_id),
  ADD CONSTRAINT sales_business_id_legacy_id_key UNIQUE (business_id,legacy_id),
  ADD CONSTRAINT sales_business_id_reversed_sale_id_key UNIQUE (business_id,reversed_sale_id),
  ADD CONSTRAINT sales_reversed_sale_fk FOREIGN KEY (business_id,reversed_sale_id)
    REFERENCES vendora.sales(business_id,id) ON DELETE NO ACTION ON UPDATE NO ACTION;
CREATE INDEX sales_business_id_sync_seq_idx ON vendora.sales(business_id,sync_seq);

CREATE TABLE vendora.stock_movements (
  id UUID NOT NULL PRIMARY KEY,
  business_id UUID NOT NULL REFERENCES vendora.businesses(id) ON DELETE RESTRICT ON UPDATE CASCADE,
  product_id UUID NOT NULL,
  sale_id UUID,
  type vendora.stock_movement_type NOT NULL,
  quantity NUMERIC(12,3) NOT NULL,
  quantity_before NUMERIC(12,3) NOT NULL,
  quantity_after NUMERIC(12,3) NOT NULL,
  source TEXT NOT NULL CHECK (btrim(source) <> ''),
  reference_id TEXT,
  created_by_id UUID REFERENCES vendora.users(id) ON DELETE RESTRICT ON UPDATE CASCADE,
  client_id UUID,
  legacy_id TEXT,
  oversold BOOLEAN NOT NULL DEFAULT FALSE,
  metadata JSONB NOT NULL DEFAULT '{}',
  sync_seq BIGINT NOT NULL DEFAULT 0 CHECK (sync_seq >= 0),
  created_at TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  deleted_at TIMESTAMPTZ(3) CHECK (deleted_at IS NULL),
  UNIQUE (business_id,id),
  UNIQUE (business_id,client_id),
  UNIQUE (business_id,legacy_id),
  CHECK (quantity_after = quantity_before + quantity),
  CHECK (NOT oversold OR quantity_after < 0),
  FOREIGN KEY (business_id,product_id) REFERENCES vendora.products(business_id,id) ON DELETE RESTRICT ON UPDATE CASCADE,
  FOREIGN KEY (business_id,sale_id) REFERENCES vendora.sales(business_id,id) ON DELETE RESTRICT ON UPDATE CASCADE
);
CREATE INDEX stock_movements_business_id_product_id_created_at_idx ON vendora.stock_movements(business_id,product_id,created_at);
CREATE INDEX stock_movements_business_id_sync_seq_idx ON vendora.stock_movements(business_id,sync_seq);

-- Immutable events avoid cursor gaps when an entity changes twice between pulls.
CREATE TABLE vendora.sync_changes (
  business_id UUID NOT NULL REFERENCES vendora.businesses(id) ON DELETE RESTRICT ON UPDATE CASCADE,
  seq BIGINT NOT NULL CHECK (seq > 0),
  entity TEXT NOT NULL CHECK (entity IN ('product','sale','movement')),
  entity_id UUID NOT NULL,
  payload JSONB NOT NULL,
  created_at TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (business_id,seq)
);

CREATE FUNCTION vendora.reject_inventory_ledger_mutation() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION 'Posted inventory ledger rows are append-only; append a correction or reversal' USING ERRCODE='23514';
END $$;
CREATE TRIGGER stock_movements_immutable BEFORE UPDATE OR DELETE ON vendora.stock_movements
  FOR EACH ROW EXECUTE FUNCTION vendora.reject_inventory_ledger_mutation();
CREATE TRIGGER sync_changes_immutable BEFORE UPDATE OR DELETE ON vendora.sync_changes
  FOR EACH ROW EXECUTE FUNCTION vendora.reject_inventory_ledger_mutation();

REVOKE ALL ON vendora.stock_movements, vendora.sync_changes FROM PUBLIC;
DO $$ DECLARE role_name text; BEGIN
  FOREACH role_name IN ARRAY ARRAY['anon','authenticated'] LOOP
    IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname=role_name) THEN
      EXECUTE format('REVOKE ALL ON vendora.stock_movements, vendora.sync_changes FROM %I', role_name);
    END IF;
  END LOOP;
END $$;

COMMENT ON TABLE vendora.stock_movements IS 'Append-only stock ledger; posted rows cannot be edited or tombstoned.';
COMMENT ON TABLE vendora.sync_changes IS 'Append-only per-business cursor events; seq allocated under the business row lock.';
COMMIT;
