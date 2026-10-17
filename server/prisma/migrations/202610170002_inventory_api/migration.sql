BEGIN;
CREATE TABLE vendora.inventory_operations (
  business_id UUID NOT NULL REFERENCES vendora.businesses(id) ON DELETE RESTRICT ON UPDATE CASCADE,
  client_id UUID NOT NULL,
  action TEXT NOT NULL CHECK (btrim(action) <> ''),
  request_hash TEXT NOT NULL CHECK (request_hash ~ '^[0-9a-f]{64}$'),
  result JSONB NOT NULL CHECK (jsonb_typeof(result) = 'object'),
  metadata JSONB NOT NULL DEFAULT '{}',
  created_by_id UUID NOT NULL REFERENCES vendora.users(id) ON DELETE RESTRICT ON UPDATE CASCADE,
  created_at TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (business_id,client_id)
);
CREATE TRIGGER inventory_operations_immutable BEFORE UPDATE OR DELETE ON vendora.inventory_operations
  FOR EACH ROW EXECUTE FUNCTION vendora.reject_inventory_ledger_mutation();

CREATE TABLE vendora.notifications (
  id UUID NOT NULL PRIMARY KEY,
  business_id UUID NOT NULL REFERENCES vendora.businesses(id) ON DELETE RESTRICT ON UPDATE CASCADE,
  product_id UUID NOT NULL,
  type TEXT NOT NULL CHECK (type IN ('LOW_STOCK','OVERSOLD')),
  message TEXT NOT NULL,
  created_at TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  read_at TIMESTAMPTZ(3),
  FOREIGN KEY (business_id,product_id) REFERENCES vendora.products(business_id,id) ON DELETE RESTRICT ON UPDATE CASCADE
);
CREATE INDEX notifications_business_id_read_at_created_at_idx ON vendora.notifications(business_id,read_at,created_at);
-- SQL-owned partial uniqueness: retain history while allowing one unread alert.
CREATE UNIQUE INDEX notifications_one_unread_product ON vendora.notifications(business_id,product_id) WHERE read_at IS NULL;
REVOKE ALL ON vendora.inventory_operations, vendora.notifications FROM PUBLIC;
DO $$ DECLARE role_name text; BEGIN
  FOREACH role_name IN ARRAY ARRAY['anon','authenticated'] LOOP
    IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname=role_name) THEN
      EXECUTE format('REVOKE ALL ON vendora.inventory_operations, vendora.notifications FROM %I', role_name);
    END IF;
  END LOOP;
END $$;
COMMIT;
