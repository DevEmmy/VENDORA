BEGIN;
-- Negative inventory is necessary for physical offline sales and reconciliation.
-- Online shortage rejection belongs in the shared, locked movement transaction.
ALTER TABLE vendora.products DROP CONSTRAINT products_stock_qty_check;
ALTER TABLE vendora.businesses ADD COLUMN invoice_seq BIGINT NOT NULL DEFAULT 0 CHECK (invoice_seq >= 0);
ALTER TABLE vendora.sales ADD COLUMN invoice_no TEXT;
ALTER TABLE vendora.sales ADD CONSTRAINT sales_business_id_invoice_no_key UNIQUE (business_id,invoice_no);
ALTER TABLE vendora.sale_items
  ADD COLUMN product_name TEXT NOT NULL DEFAULT '',
  ADD COLUMN unit TEXT NOT NULL DEFAULT 'piece';
UPDATE vendora.sale_items AS item SET product_name=product.name,unit=product.unit
  FROM vendora.products AS product WHERE item.business_id=product.business_id AND item.product_id=product.id;
ALTER TABLE vendora.payments ADD COLUMN created_by_id UUID
  REFERENCES vendora.users(id) ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE vendora.customers ADD COLUMN client_id UUID, ADD COLUMN legacy_id TEXT;
ALTER TABLE vendora.customers ADD CONSTRAINT customers_business_id_client_id_key UNIQUE (business_id,client_id),
  ADD CONSTRAINT customers_business_id_legacy_id_key UNIQUE (business_id,legacy_id);
ALTER TABLE vendora.payments ADD COLUMN client_id UUID,
  ADD CONSTRAINT payments_business_id_client_id_key UNIQUE (business_id,client_id);
COMMIT;
