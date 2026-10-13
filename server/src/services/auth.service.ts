import { HttpError } from "../middleware/error-handler";
import type { AuthRepository } from "../repositories/auth.repository";
import type { Passwords } from "./password.service";
import type { Sessions } from "./session.service";

export class AuthService {
  constructor(
    private repo: AuthRepository,
    private passwords: Passwords,
    private sessions: Sessions,
  ) {}
  async register(phone: string, password: string, requestId: string) {
    await this.passwords.validate(password);
    const passwordHash = await this.passwords.hash(password);
    const created = await this.repo.db.user.createMany({
      data: { phone, passwordHash, status: "active" },
      skipDuplicates: true,
    });
    if (!created.count) throw new HttpError(409, "Phone number already registered");
    const user = await this.repo.userByPhone(phone);
    if (!user) throw new HttpError(503, "Please try again later");
    await this.repo.audit("register", "success", requestId, user.id);
    return user;
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
