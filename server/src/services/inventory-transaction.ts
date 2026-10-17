import { createHash } from "node:crypto";
import { Prisma, type PrismaClient } from "../generated/prisma/client";
import { HttpError } from "../middleware/error-handler";
import type { Transaction } from "../repositories/auth.repository";
import type { InventoryActor, OperationOutcome } from "../types/inventory";

function canonical(value: unknown): string {
  if (value instanceof Date) return JSON.stringify(value.toISOString());
  if (value instanceof Prisma.Decimal || typeof value === "bigint") return JSON.stringify(value.toString());
  if (Array.isArray(value)) return `[${value.map(canonical).join(",")}]`;
  if (value && typeof value === "object") {
    const object = value as Record<string, unknown>;
    return `{${Object.keys(object).filter(key => object[key] !== undefined).sort()
      .map(key => `${JSON.stringify(key)}:${canonical(object[key])}`).join(",")}}`;
  }
  return JSON.stringify(value) ?? "null";
}

export function inventoryJson(value: object): Prisma.InputJsonObject {
  return JSON.parse(JSON.stringify(value)) as Prisma.InputJsonObject;
}

export async function requireRelational(tx: Transaction | PrismaClient, businessId: string) {
  const business = await tx.business.findUnique({ where: { id: businessId } });
  if (!business) throw new HttpError(404, "Not found");
  if (business.inventoryMode !== "RELATIONAL")
    throw new HttpError(409, "This business needs inventory migration before using this endpoint", "INVENTORY_MIGRATION_REQUIRED");
  return business;
}

export async function nextInventorySeq(tx: Transaction, businessId: string) {
  const business = await tx.business.update({ where: { id: businessId },
    data: { syncSeq: { increment: 1 } }, select: { syncSeq: true } });
  return business.syncSeq;
}

interface Operation {
  clientId: string;
  action: string;
  payload: unknown;
  metadata?: Prisma.InputJsonObject;
}

export async function inventoryOperation<T extends object>(db: PrismaClient, actor: InventoryActor,
  operation: Operation, execute: (tx: Transaction) => Promise<T>): Promise<OperationOutcome<T>> {
  const requestHash = createHash("sha256").update(canonical({ action: operation.action, payload: operation.payload })).digest("hex");
  try {
    return await db.$transaction(async tx => {
      // The same first lock on every inventory write serializes commits and
      // sequence allocation. A cursor can never overtake an uncommitted change.
      await tx.$queryRaw`SELECT id FROM vendora.businesses WHERE id=${actor.businessId}::uuid FOR UPDATE`;
      await requireRelational(tx, actor.businessId);
      const membership = await tx.membership.findUnique({
        where: { userId_businessId: { userId: actor.userId, businessId: actor.businessId } },
        include: { user: { select: { status: true } } },
      });
      if (!membership || membership.status !== "active" || membership.user.status !== "active" ||
          !membership.permissions.includes("sales:write")) throw new HttpError(403, "Permission required");
      const previous = await tx.inventoryOperation.findUnique({
        where: { businessId_clientId: { businessId: actor.businessId, clientId: operation.clientId } },
      });
      if (previous) {
        if (previous.action !== operation.action || previous.requestHash !== requestHash)
          throw new HttpError(409, "This operation ID already has different details", "IDEMPOTENCY_CONFLICT");
        return { result: previous.result as unknown as T, duplicate: true };
      }
      const result = await execute(tx);
      await tx.inventoryOperation.create({ data: { businessId: actor.businessId,
        clientId: operation.clientId, action: operation.action, requestHash,
        result: inventoryJson(result), metadata: operation.metadata ?? {}, createdById: actor.userId } });
      return { result, duplicate: false };
    }, { maxWait: 15_000, timeout: 20_000 });
  } catch (error: unknown) {
    if (typeof error === "object" && error && "code" in error && error.code === "P2002")
      throw new HttpError(409, "A conflicting record already exists", "IDEMPOTENCY_CONFLICT");
    throw error;
  }
}
