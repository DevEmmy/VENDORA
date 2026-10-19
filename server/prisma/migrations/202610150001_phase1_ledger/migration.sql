-- Phase 1 only: preserve all auth tables and membership ownership.
CREATE EXTENSION IF NOT EXISTS pg_trgm WITH SCHEMA public;

CREATE TABLE vendora.products (
  id UUID NOT NULL PRIMARY KEY,
  business_id UUID NOT NULL REFERENCES vendora.businesses(id) ON DELETE RESTRICT ON UPDATE CASCADE,
  name TEXT NOT NULL CHECK (btrim(name) <> ''),
  unit_price BIGINT NOT NULL CHECK (unit_price >= 0),
  cost_price BIGINT CHECK (cost_price >= 0),
  stock_qty INTEGER NOT NULL DEFAULT 0 CHECK (stock_qty >= 0),
  low_stock_at INTEGER NOT NULL DEFAULT 5 CHECK (low_stock_at >= 0),
  created_at TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE (business_id, id)
);
CREATE INDEX products_business_id_idx ON vendora.products(business_id);

CREATE TABLE vendora.customers (
  id UUID NOT NULL PRIMARY KEY,
  business_id UUID NOT NULL REFERENCES vendora.businesses(id) ON DELETE RESTRICT ON UPDATE CASCADE,
  name TEXT NOT NULL CHECK (btrim(name) <> ''),
  phone TEXT,
  created_at TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE (business_id, id)
);
CREATE INDEX customers_business_id_idx ON vendora.customers(business_id);

CREATE TABLE vendora.sales (
  id UUID NOT NULL PRIMARY KEY,
  business_id UUID NOT NULL REFERENCES vendora.businesses(id) ON DELETE RESTRICT ON UPDATE CASCADE,
  customer_id UUID,
  total BIGINT NOT NULL CHECK (total >= 0),
  amount_paid BIGINT NOT NULL DEFAULT 0 CHECK (amount_paid >= 0 AND amount_paid <= total),
  created_at TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE (business_id, id),
  FOREIGN KEY (business_id, customer_id) REFERENCES vendora.customers(business_id, id) ON DELETE RESTRICT ON UPDATE CASCADE
);
CREATE INDEX sales_business_id_idx ON vendora.sales(business_id);

CREATE TABLE vendora.sale_items (
  id UUID NOT NULL PRIMARY KEY,
  business_id UUID NOT NULL REFERENCES vendora.businesses(id) ON DELETE RESTRICT ON UPDATE CASCADE,
  sale_id UUID NOT NULL,
  product_id UUID NOT NULL,
  quantity INTEGER NOT NULL CHECK (quantity > 0),
  unit_price BIGINT NOT NULL CHECK (unit_price >= 0),
  FOREIGN KEY (business_id, sale_id) REFERENCES vendora.sales(business_id, id) ON DELETE CASCADE ON UPDATE CASCADE,
  FOREIGN KEY (business_id, product_id) REFERENCES vendora.products(business_id, id) ON DELETE RESTRICT ON UPDATE CASCADE
);
CREATE INDEX sale_items_business_id_idx ON vendora.sale_items(business_id);

CREATE TABLE vendora.payments (
  id UUID NOT NULL PRIMARY KEY,
  business_id UUID NOT NULL REFERENCES vendora.businesses(id) ON DELETE RESTRICT ON UPDATE CASCADE,
  sale_id UUID NOT NULL,
  amount BIGINT NOT NULL CHECK (amount > 0),
  created_at TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (business_id, sale_id) REFERENCES vendora.sales(business_id, id) ON DELETE CASCADE ON UPDATE CASCADE
);
CREATE INDEX payments_business_id_idx ON vendora.payments(business_id);

CREATE TABLE vendora.expenses (
  id UUID NOT NULL PRIMARY KEY,
  business_id UUID NOT NULL REFERENCES vendora.businesses(id) ON DELETE RESTRICT ON UPDATE CASCADE,
  description TEXT NOT NULL CHECK (btrim(description) <> ''),
  amount BIGINT NOT NULL CHECK (amount > 0),
  category TEXT,
  created_at TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX expenses_business_id_idx ON vendora.expenses(business_id);

COMMENT ON COLUMN vendora.products.unit_price IS 'Integer kobo (NGN smallest unit); never floats or decimals.';
COMMENT ON COLUMN vendora.products.cost_price IS 'Integer kobo (NGN smallest unit); never floats or decimals.';
COMMENT ON COLUMN vendora.sales.total IS 'Integer kobo (NGN smallest unit); never floats or decimals.';
COMMENT ON COLUMN vendora.sales.amount_paid IS 'Integer kobo (NGN smallest unit); never floats or decimals.';
COMMENT ON COLUMN vendora.sale_items.unit_price IS 'Integer kobo (NGN smallest unit); never floats or decimals.';
COMMENT ON COLUMN vendora.payments.amount IS 'Integer kobo (NGN smallest unit); never floats or decimals.';
COMMENT ON COLUMN vendora.expenses.amount IS 'Integer kobo (NGN smallest unit); never floats or decimals.';

CREATE INDEX sales_business_id_created_at_idx ON vendora.sales(business_id, created_at);
CREATE INDEX expenses_business_id_created_at_idx ON vendora.expenses(business_id, created_at);
CREATE INDEX sales_business_id_customer_id_idx ON vendora.sales(business_id, customer_id);
CREATE INDEX sale_items_sale_id_idx ON vendora.sale_items(sale_id);
CREATE INDEX sale_items_business_id_product_id_idx ON vendora.sale_items(business_id, product_id);
CREATE INDEX payments_sale_id_idx ON vendora.payments(sale_id);
CREATE INDEX products_name_trgm_idx ON vendora.products USING GIN (name public.gin_trgm_ops);
CREATE INDEX customers_name_trgm_idx ON vendora.customers USING GIN (name public.gin_trgm_ops);

-- Preserve the existing backend-only schema security policy, including inherited defaults.
REVOKE ALL ON vendora.products, vendora.customers, vendora.sales,
  vendora.sale_items, vendora.payments, vendora.expenses FROM PUBLIC;
DO $$
DECLARE role_name text;
BEGIN
  FOREACH role_name IN ARRAY ARRAY['anon', 'authenticated'] LOOP
    IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = role_name) THEN
      EXECUTE format('REVOKE ALL ON vendora.products, vendora.customers, vendora.sales, vendora.sale_items, vendora.payments, vendora.expenses FROM %I', role_name);
    END IF;
  END LOOP;
END $$;
