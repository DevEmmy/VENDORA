import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import type { Client } from "pg";
import { connectDemo, demoBusiness } from "./phase1-database";

export async function constraints(client: Client) {
  await client.query("BEGIN");
  try {
    const sale = (await client.query("SELECT id FROM vendora.sales WHERE business_id=$1 LIMIT 1", [demoBusiness])).rows[0]?.id as string | undefined;
    const product = (await client.query("SELECT id FROM vendora.products WHERE business_id=$1 LIMIT 1", [demoBusiness])).rows[0]?.id as string | undefined;
    const customer = (await client.query("SELECT id FROM vendora.customers WHERE business_id=$1 LIMIT 1", [demoBusiness])).rows[0]?.id as string | undefined;
    assert(sale && product && customer, "Seed demo data before testing constraints");
    const other = randomUUID();
    await client.query('INSERT INTO vendora.businesses (id,phone) VALUES ($1,$2)', [other, `phase1-constraint-${other}`]);
    const reject = async (label: string, sql: string, params: unknown[], code = "23514") => {
      await client.query("SAVEPOINT invalid_case");
      let caught: unknown;
      try { await client.query(sql, params); } catch (error) { caught = error; }
      await client.query("ROLLBACK TO SAVEPOINT invalid_case");
      await client.query("RELEASE SAVEPOINT invalid_case");
      assert(caught && typeof caught === "object" && "code" in caught);
      assert.equal(caught.code, code, label);
      console.log(`PASS ${label}: PostgreSQL ${code}`);
    };
    await reject("overpaid sale", "INSERT INTO vendora.sales (id,business_id,total,amount_paid) VALUES ($1,$2,100,101)", [randomUUID(), demoBusiness]);
    await reject("negative stock", "INSERT INTO vendora.products (id,business_id,name,unit_price,stock_qty) VALUES ($1,$2,'invalid',100,-1)", [randomUUID(), demoBusiness]);
    await reject("zero quantity", "INSERT INTO vendora.sale_items (id,business_id,sale_id,product_id,quantity,unit_price) VALUES ($1,$2,$3,$4,0,100)", [randomUUID(), demoBusiness, sale, product]);
    await reject("negative amount_paid", "INSERT INTO vendora.sales (id,business_id,total,amount_paid) VALUES ($1,$2,100,-1)", [randomUUID(), demoBusiness]);
    await reject("zero repayment", "INSERT INTO vendora.payments (id,business_id,sale_id,amount) VALUES ($1,$2,$3,0)", [randomUUID(), demoBusiness, sale]);
    await reject("zero expense", "INSERT INTO vendora.expenses (id,business_id,description,amount) VALUES ($1,$2,'invalid',0)", [randomUUID(), demoBusiness]);
    await reject("negative unit price", "INSERT INTO vendora.products (id,business_id,name,unit_price) VALUES ($1,$2,'invalid',-1)", [randomUUID(), demoBusiness]);
    await reject("cross-business customer", "INSERT INTO vendora.sales (id,business_id,customer_id,total) VALUES ($1,$2,$3,100)", [randomUUID(), other, customer], "23503");
    await reject("cross-business sale item", "INSERT INTO vendora.sale_items (id,business_id,sale_id,product_id,quantity,unit_price) VALUES ($1,$2,$3,$4,1,100)", [randomUUID(), other, sale, product], "23503");
    await reject("cross-business repayment", "INSERT INTO vendora.payments (id,business_id,sale_id,amount) VALUES ($1,$2,$3,100)", [randomUUID(), other, sale], "23503");
    const tempSale = randomUUID();
    await client.query("INSERT INTO vendora.sales (id,business_id,total) VALUES ($1,$2,5000000000)", [tempSale, demoBusiness]);
    const otherSale = randomUUID();
    await client.query("INSERT INTO vendora.sales (id,business_id,total) VALUES ($1,$2,100)", [otherSale, other]);
    await reject("cross-business product", "INSERT INTO vendora.sale_items (id,business_id,sale_id,product_id,quantity,unit_price) VALUES ($1,$2,$3,$4,1,100)", [randomUUID(), other, otherSale, product], "23503");
    await client.query("INSERT INTO vendora.sale_items (id,business_id,sale_id,product_id,quantity,unit_price) VALUES ($1,$2,$3,$4,1,5000000000)", [randomUUID(), demoBusiness, tempSale, product]);
    await client.query("INSERT INTO vendora.payments (id,business_id,sale_id,amount) VALUES ($1,$2,$3,100)", [randomUUID(), demoBusiness, tempSale]);
    await reject("referenced product deletion", "DELETE FROM vendora.products WHERE id=$1", [product], "23001");
    await reject("referenced business deletion", "DELETE FROM vendora.businesses WHERE id=$1", [demoBusiness], "23001");
    await client.query("DELETE FROM vendora.sales WHERE id=$1", [tempSale]);
    assert.equal((await client.query("SELECT (SELECT count(*) FROM vendora.sale_items WHERE sale_id=$1) + (SELECT count(*) FROM vendora.payments WHERE sale_id=$1) AS count", [tempSale])).rows[0].count, "0");
    console.log("PASS bigint > 32-bit and sale deletion cascades to items/payments");
  } finally { await client.query("ROLLBACK"); }
}

async function main() {
  if (process.argv[1]?.endsWith("phase1-constraints.ts")) {
    const client = await connectDemo();
    try { await constraints(client); } finally { await client.end(); }
  }
}
void main().catch((error: unknown) => { console.error(error); process.exitCode = 1; });
