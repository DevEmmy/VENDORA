import type { Prisma, PrismaClient } from "../generated/prisma/client";
import { HttpError } from "../middleware/error-handler";

export type Transaction = Prisma.TransactionClient;
export class AuthRepository {
  constructor(public db: PrismaClient) {}
  transaction<T>(fn: (tx: Transaction) => Promise<T>) {
    return this.db.$transaction(fn, { timeout: 10_000 });
  }
  async lockUser(tx: Transaction, id: string) {
    await tx.$queryRaw`SELECT id FROM vendora.users WHERE id = ${id}::uuid FOR UPDATE`;
  }
  async lockSession(tx: Transaction, id: string) {
    await tx.$queryRaw`SELECT id FROM vendora.sessions WHERE id = ${id}::uuid FOR UPDATE`;
  }
  userByPhone(phone: string) {
    return this.db.user.findUnique({ where: { phone } });
  }
  memberships(userId: string) {
    return this.db.membership.findMany({
      where: { userId, status: "active" },
      include: { business: true },
    });
  }
  async ownership(businessId: string, kind: string, resourceId: string) {
    const found = await this.db.resourceOwnership.findUnique({
      where: { kind_resourceId: { kind, resourceId } },
    });
    if (!found || found.businessId !== businessId)
      throw new HttpError(404, "Not found");
  }
  audit(
    action: string,
    outcome: string,
    requestId: string,
    userId?: string,
    sessionId?: string,
    tx: Transaction = this.db,
  ) {
    return tx.auditEvent.create({
      data: {
        action,
        outcome,
        requestId,
        ...(userId ? { userId } : {}),
        ...(sessionId ? { sessionId } : {}),
      },
    });
  }
}
