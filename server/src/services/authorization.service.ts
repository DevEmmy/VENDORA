import { HttpError } from "../middleware/error-handler";
import type { AuthRepository } from "../repositories/auth.repository";
import type { AuthContext } from "../types/auth";

export class Authorization {
  constructor(private repo: AuthRepository) {}
  async business(auth: AuthContext, permission: string, requested?: string) {
    const memberships = await this.repo.memberships(auth.user.id);
    const membership = requested
      ? memberships.find((m) => m.businessId === requested)
      : memberships.length === 1
        ? memberships[0]
        : undefined;
    if (!membership) throw new HttpError(403, "Business membership required");
    if (!membership.permissions.includes(permission))
      throw new HttpError(403, "Permission required");
    await this.repo.ownership(
      membership.businessId,
      "trader",
      membership.business.phone,
    );
    return membership;
  }
}
