import "dotenv/config";
import { readFileSync } from "node:fs";
import { parseArgs } from "node:util";
import { z } from "zod";
import { loadConfig } from "../src/config/env";
import { createDatabase } from "../src/db/prisma";
import type { Prisma } from "../src/generated/prisma/client";

// Offline operator workflow. Never invoke this from a public browser endpoint.
async function main() {
  const { values } = parseArgs({
    options: {
      "user-id": { type: "string" },
      phone: { type: "string" },
      "evidence-ref": { type: "string" },
      "legacy-file": { type: "string" },
    },
  });
  const input = z
    .object({
      "user-id": z.string().uuid(),
      phone: z.string().regex(/^[1-9]\d{9,14}$/),
      "evidence-ref": z.string().min(8).max(100),
      "legacy-file": z.string().optional(),
    })
    .parse(values);
  const config = loadConfig();
  const db = createDatabase(config);
  try {
    const user = await db.user.findUniqueOrThrow({
      where: { id: input["user-id"] },
    });
    if (
      user.status !== "active" ||
      user.phone !== input.phone
    )
      throw new Error("Active owner phone must match the business phone");
    const old: unknown = input["legacy-file"]
      ? JSON.parse(readFileSync(input["legacy-file"], "utf8"))
      : {};
    const data = z
      .object({
        traders: z
          .record(z.string(), z.record(z.string(), z.unknown()))
          .default({}),
        accounts: z
          .record(z.string(), z.object({ phone: z.string() }).passthrough())
          .default({}),
        paymentRequests: z
          .record(
            z.string(),
            z.object({ accountNumber: z.string() }).passthrough(),
          )
          .default({}),
        loans: z
          .record(
            z.string(),
            z.object({ accountNumber: z.string() }).passthrough(),
          )
          .default({}),
      })
      .parse(old);
    await db.$transaction(async (tx) => {
      const business = await tx.business.create({
        data: { phone: input.phone },
      });
      await tx.membership.create({
        data: {
          userId: user.id,
          businessId: business.id,
          role: "owner",
          permissions: [
            "sales:write",
            "submissions:write",
            "bank:read",
            "bank:write",
          ],
        },
      });
      await tx.resourceOwnership.create({
        data: {
          kind: "trader",
          resourceId: input.phone,
          businessId: business.id,
        },
      });
      await tx.businessSnapshot.create({
        data: {
          businessId: business.id,
          state: JSON.parse(
            JSON.stringify(data.traders[input.phone] ?? { phone: input.phone }),
          ) as Prisma.InputJsonObject,
        },
      });
      const ownedAccounts = Object.entries(data.accounts)
        .filter(([, account]) => account.phone === input.phone)
        .map(([id]) => id);
      for (const account of ownedAccounts)
        await tx.resourceOwnership.create({
          data: {
            kind: "account",
            resourceId: account,
            businessId: business.id,
          },
        });
      for (const [id, pr] of Object.entries(data.paymentRequests))
        if (ownedAccounts.includes(pr.accountNumber))
          await tx.resourceOwnership.create({
            data: {
              kind: "payment-request",
              resourceId: id,
              businessId: business.id,
            },
          });
      for (const [id, loan] of Object.entries(data.loans))
        if (ownedAccounts.includes(loan.accountNumber))
          await tx.resourceOwnership.create({
            data: { kind: "loan", resourceId: id, businessId: business.id },
          });
      await tx.auditEvent.create({
        data: {
          action: "business-claim",
          outcome: "operator-approved",
          userId: user.id,
          requestId: input["evidence-ref"],
        },
      });
    });
    console.log(
      "Business provisioned with audited ownership. WhatsApp remains unlinked until the owner opts in.",
    );
  } finally {
    await db.$disconnect();
  }
}
void main().catch(() => {
  console.error(
    "Provisioning failed; check owner, evidence reference, and ownership conflicts",
  );
  process.exitCode = 1;
});
