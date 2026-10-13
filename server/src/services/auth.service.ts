import { HttpError } from "../middleware/error-handler";
import type { AuthRepository } from "../repositories/auth.repository";
import type { Registration } from "../schemas/auth.schemas";
import type { Passwords } from "./password.service";
import type { Sessions } from "./session.service";

export class AuthService {
  constructor(
    private repo: AuthRepository,
    private passwords: Passwords,
    private sessions: Sessions,
  ) {}
  async register(input: Registration, requestId: string) {
    const { phone, password, name, businessName, businessType, city } = input;
    await this.passwords.validate(password);
    const passwordHash = await this.passwords.hash(password);
    return this.repo.transaction(async (tx) => {
      const created = await tx.user.createMany({
        data: { phone, passwordHash, name, status: "active" },
        skipDuplicates: true,
      });
      if (!created.count) throw new HttpError(409, "Phone number already registered");
      const user = await tx.user.findUniqueOrThrow({ where: { phone } });
      // Never assign an existing business or trader record based on a phone alone.
      const shop = await tx.business.createMany({
        data: { phone, businessName, businessType, city },
        skipDuplicates: true,
      });
      if (!shop.count) throw new HttpError(409, "Phone number already associated with a shop");
      const business = await tx.business.findUniqueOrThrow({ where: { phone } });
      if (await tx.resourceOwnership.findUnique({
        where: { kind_resourceId: { kind: "trader", resourceId: phone } },
      })) throw new HttpError(409, "Phone number already associated with a shop");
      const membership = await tx.membership.create({
        data: {
          userId: user.id, businessId: business.id, role: "owner",
          permissions: ["sales:write", "submissions:write", "bank:read", "bank:write"],
        },
      });
      await tx.resourceOwnership.create({
        data: { kind: "trader", resourceId: phone, businessId: business.id },
      });
      await tx.businessSnapshot.create({
        data: {
          businessId: business.id,
          state: { name, phone, businessName, businessType, city, inventory: [], customers: [], seals: [] },
        },
      });
      await this.repo.audit("register", "success", requestId, user.id, undefined, tx);
      return { user, business, membership };
    });
  }
  async login(phone: string, password: string, requestId: string) {
    const user = await this.repo.userByPhone(phone);
    const verified = await this.passwords.verify(user?.passwordHash, password);
    if (
      !verified ||
      !user ||
      !["active", "pending"].includes(user.status)
    ) {
      await this.repo.audit("login", "failure", requestId);
      throw new HttpError(401, "Invalid credentials");
    }
    // Existing accounts awaiting OTP can now log in with their original password.
    if (user.status === "pending") {
      const updated = await this.repo.db.user.updateMany({
        where: { id: user.id, status: "pending", authVersion: user.authVersion },
        data: { status: "active" },
      });
      if (!updated.count) throw new HttpError(401, "Invalid credentials");
      user.status = "active";
    }
    if (this.passwords.needsRehash(user.passwordHash)) {
      const hash = await this.passwords.hash(password);
      await this.repo.db.user.updateMany({
        where: { id: user.id, passwordHash: user.passwordHash },
        data: { passwordHash: hash },
      });
    }
    return { user, ...(await this.sessions.create(user, requestId)) };
  }
}
