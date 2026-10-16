-- Run transactionally through phase1:down; keep the shared pg_trgm extension.
DROP TABLE vendora.payments;
DROP TABLE vendora.sale_items;
DROP TABLE vendora.expenses;
DROP TABLE vendora.sales;
DROP TABLE vendora.customers;
DROP TABLE vendora.products;
