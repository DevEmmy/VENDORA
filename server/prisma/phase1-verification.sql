-- Each section is executed independently with $1 = business UUID.
-- report: a) Sales and expenses (integer kobo)
WITH bounds AS (
  SELECT date_trunc('day', CURRENT_TIMESTAMP AT TIME ZONE 'Africa/Lagos') AS today
), periods AS (
  SELECT 'today' AS period, today AT TIME ZONE 'Africa/Lagos' AS start_at,
    (today + interval '1 day') AT TIME ZONE 'Africa/Lagos' AS end_at FROM bounds
  UNION ALL
  SELECT 'last_7_days', (today - interval '6 days') AT TIME ZONE 'Africa/Lagos',
    (today + interval '1 day') AT TIME ZONE 'Africa/Lagos' FROM bounds
)
SELECT period,
  (SELECT coalesce(sum(total),0)::text FROM vendora.sales
    WHERE business_id=$1::uuid AND created_at >= p.start_at AND created_at < p.end_at) AS sales_kobo,
  (SELECT coalesce(sum(amount),0)::text FROM vendora.expenses
    WHERE business_id=$1::uuid AND created_at >= p.start_at AND created_at < p.end_at) AS expenses_kobo
FROM periods p ORDER BY start_at DESC;

-- report: b) Outstanding debt per customer (integer kobo)
SELECT c.name, sum(s.total - s.amount_paid)::text AS owed_kobo
FROM vendora.sales s JOIN vendora.customers c
  ON c.id=s.customer_id AND c.business_id=s.business_id
WHERE s.business_id=$1::uuid
GROUP BY c.id, c.name HAVING sum(s.total-s.amount_paid)>0
ORDER BY sum(s.total-s.amount_paid) DESC, c.name;

-- report: c) Low stock
SELECT name, stock_qty, low_stock_at FROM vendora.products
WHERE business_id=$1::uuid AND stock_qty <= low_stock_at ORDER BY name;

-- report: d) Top 3 by quantity this week (Monday, Africa/Lagos)
SELECT p.name, sum(i.quantity)::text AS quantity
FROM vendora.sale_items i JOIN vendora.sales s ON s.id=i.sale_id AND s.business_id=i.business_id
JOIN vendora.products p ON p.id=i.product_id AND p.business_id=i.business_id
WHERE i.business_id=$1::uuid
  AND s.created_at >= date_trunc('week', CURRENT_TIMESTAMP AT TIME ZONE 'Africa/Lagos') AT TIME ZONE 'Africa/Lagos'
  AND s.created_at < (date_trunc('day', CURRENT_TIMESTAMP AT TIME ZONE 'Africa/Lagos') + interval '1 day') AT TIME ZONE 'Africa/Lagos'
GROUP BY p.id, p.name ORDER BY sum(i.quantity) DESC, p.name LIMIT 3;

-- report: e) Fuzzy product search: indomi
SELECT name, unit_price::text AS unit_price_kobo,
  round(public.similarity(name, 'indomi')::numeric, 3)::text AS similarity
FROM vendora.products WHERE business_id=$1::uuid
  AND (name ILIKE '%indomi%' OR name OPERATOR(public.%) 'indomi')
ORDER BY public.similarity(name, 'indomi') DESC, name LIMIT 5;
