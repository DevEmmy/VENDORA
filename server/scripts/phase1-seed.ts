import { randomUUID } from "node:crypto";
import { PrismaPg } from "@prisma/adapter-pg";
import { PrismaClient } from "../src/generated/prisma/client";
import { connectDemo, demoBusiness, demoPhone, demoUser } from "./phase1-database";

const demoName = "Vendora Phase 1 Demo - Ngozi Provisions";
const disabledHash = "!vendora-phase1-demo-login-disabled";
const products = [
  ["Indomie Chicken 70g", 15000n, 12000n, 3],
  ["Peak Milk 170g", 180000n, 150000n, 2],
  ["Mama Gold Rice 1kg", 220000n, 195000n, 30],
  ["Gino Tomato Paste 70g", 60000n, 48000n, 40],
  ["Golden Penny Spaghetti 500g", 120000n, 100000n, 25],
  ["Dangote Sugar 500g", 140000n, 120000n, 20],
  ["Golden Penny Semovita 1kg", 190000n, 165000n, 18],
  ["Kings Vegetable Oil 1L", 350000n, 310000n, 12],
  ["Cabin Biscuits 100g", 50000n, 38000n, 35],
  ["Eva Water 75cl", 30000n, null, 50],
] as const;
const customers = ["Amina Bello", "Chinedu Okafor", "Bisi Adeyemi", "Musa Ibrahim", "Ngozi Eze", "Tunde Balogun"];
const fixedId = (n: number) => `d3e00000-0000-4000-8000-${String(n).padStart(12, "0")}`;

export async function seed(db: PrismaClient) {
  return db.$transaction(async (tx) => {
    await tx.$queryRaw`SELECT pg_advisory_xact_lock(150002)::text`;
    const user = await tx.user.findUnique({ where: { id: demoUser } });
    const business = await tx.business.findUnique({ where: { id: demoBusiness } });
    if (user && (user.phone !== demoPhone || user.name !== demoName ||
        user.status !== "disabled" || user.passwordHash !== disabledHash)) {
      throw new Error("Demo user UUID collision; refusing to change any data");
    }
    if (business && (business.phone !== demoPhone || business.businessName !== demoName)) {
      throw new Error("Demo business UUID collision; refusing to change any data");
    }
    const memberships = await tx.membership.findMany({
      where: { OR: [{ userId: demoUser }, { businessId: demoBusiness }] },
    });
    if (memberships.some((m) => m.userId !== demoUser || m.businessId !== demoBusiness || m.role !== "owner")) {
      throw new Error("Unexpected demo membership; refusing to change any data");
    }
    if (!user) await tx.user.create({ data: {
      id: demoUser, phone: demoPhone, name: demoName, status: "disabled", passwordHash: disabledHash,
    } });
    if (!business) await tx.business.create({ data: {
      id: demoBusiness, phone: demoPhone, businessName: demoName, businessType: "Provisions", city: "Lagos",
    } });
    if (!memberships.length) await tx.membership.create({ data: {
      userId: demoUser, businessId: demoBusiness, role: "owner", permissions: [],
    } });

    // Only this reserved, marked demo shop is cleared. Users/shops are never deleted.
    await tx.expense.deleteMany({ where: { businessId: demoBusiness } });
    await tx.sale.deleteMany({ where: { businessId: demoBusiness } });
    await tx.customer.deleteMany({ where: { businessId: demoBusiness } });
    await tx.product.deleteMany({ where: { businessId: demoBusiness } });
    for (const [i, p] of products.entries()) await tx.product.create({ data: {
      id: fixedId(100 + i), businessId: demoBusiness, name: p[0],
      unitPrice: p[1], costPrice: p[2], stockQty: p[3],
    } });
    for (const [i, name] of customers.entries()) await tx.customer.create({ data: {
      id: fixedId(200 + i), businessId: demoBusiness, name,
      // No real phone numbers in demo data; phone is optional.
    } });
    const [anchor] = await tx.$queryRaw<{ today: Date }[]>`
      SELECT date_trunc('day', CURRENT_TIMESTAMP AT TIME ZONE 'Africa/Lagos')
        AT TIME ZONE 'Africa/Lagos' AS today`;
    if (!anchor) throw new Error("No date anchor returned");
    const { today } = anchor;
    const at = (daysAgo: number, hour: number) => new Date(today.getTime() - daysAgo * 86400000 + hour * 3600000);
    for (let day = 0; day < 7; day++) {
      for (let saleNo = 0; saleNo < 2; saleNo++) {
        const productIndex = (day + saleNo * 3) % products.length;
        const price = products[productIndex]![1];
        const quantity = 2 + day % 3;
        const total = price * BigInt(quantity);
        const owes = saleNo === 0 && day <= 3;
        const initialPaid = owes ? (day % 2 === 0 ? total / 2n : 0n) : total;
        const sale = await tx.sale.create({ data: {
          businessId: demoBusiness,
          customerId: saleNo === 0 ? fixedId(200 + day % customers.length) : null,
          total, amountPaid: initialPaid, createdAt: at(day, 9 + saleNo),
        } });
        await tx.saleItem.create({ data: {
          businessId: demoBusiness, saleId: sale.id, productId: fixedId(100 + productIndex),
          quantity, unitPrice: price,
        } });
        if (owes && day >= 2) {
          const repayment = total / 4n;
          await tx.payment.create({ data: {
            businessId: demoBusiness, saleId: sale.id, amount: repayment, createdAt: at(day - 1, 12),
          } });
          await tx.sale.update({ where: { id: sale.id }, data: { amountPaid: { increment: repayment } } });
        }
      }
      await tx.expense.create({ data: {
        id: randomUUID(), businessId: demoBusiness,
        description: day % 2 ? "Market transport" : "Shop electricity",
        amount: BigInt(100000 + day * 10000), category: day % 2 ? "transport" : "utilities",
        createdAt: at(day, 8),
      } });
    }
  }, { timeout: 30000 });
}

async function main() {
  if (process.argv[1]?.endsWith("phase1-seed.ts")) {
    const client = await connectDemo();
    await client.end();
    const db = new PrismaClient({ adapter: new PrismaPg({ connectionString: process.env.DIRECT_URL! }) });
    try {
      await seed(db);
      console.log("Seed complete: 10 products, 6 customers, 14 sales, 2 repayments, 7 expenses; disabled demo user.");
    } finally { await db.$disconnect(); }
  }
}
void main().catch((error: unknown) => { console.error(error); process.exitCode = 1; });
