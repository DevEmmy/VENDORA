import type { Delivery } from "../adapters/delivery";
import { HttpError } from "../middleware/error-handler";
import type { AuthRepository } from "../repositories/auth.repository";
import type { AuthContext } from "../types/auth";
import type { Passwords } from "./password.service";
import { active } from "./session.service";
import { digest, opaque } from "./token.service";

export class Recovery {
  constructor(
    private repo: AuthRepository,
    private passwords: Passwords,
    private delivery: Delivery,
  ) {}
  async forgot(phone: string) {
    const user = await this.repo.userByPhone(phone);
    // Channel enrollment requires independent audited proof, never phone-only recovery.
    if (
      !user ||
      user.status !== "active" ||
      !user.recoveryDestination ||
      !user.recoveryVerifiedAt
    )
      return;
    const token = opaque();
    await this.repo.transaction(async (tx) => {
      await this.repo.lockUser(tx, user.id);
      await tx.recoveryToken.updateMany({
        where: { userId: user.id, consumedAt: null },
        data: { consumedAt: new Date() },
      });
      await tx.recoveryToken.create({
        data: {
          digest: digest(token),
          userId: user.id,
          purpose: "password-reset",
          expiresAt: new Date(Date.now() + 20 * 60_000),
        },
      });
    });
    await this.delivery.sendRecovery(user.recoveryDestination, token);
  }
  async reset(token: string, password: string, requestId: string) {
    await this.passwords.validate(password);
    const passwordHash = await this.passwords.hash(password);
    const user = await this.repo.transaction(async (tx) => {
      const proof = await tx.recoveryToken.findUnique({
        where: { digest: digest(token) },
      });
      if (!proof) throw new HttpError(400, "Invalid recovery proof");
      await this.repo.lockUser(tx, proof.userId);
      const consumed = await tx.recoveryToken.updateMany({
        where: {
          digest: proof.digest,
          purpose: "password-reset",
          consumedAt: null,
          expiresAt: { gt: new Date() },
        },
        data: { consumedAt: new Date() },
      });
      if (consumed.count !== 1)
        throw new HttpError(400, "Invalid recovery proof");
      const current = await tx.user.findUniqueOrThrow({
        where: { id: proof.userId },
      });
      if (current.status !== "active" || !current.recoveryVerifiedAt)
        throw new HttpError(400, "Invalid recovery proof");
      const updated = await tx.user.update({
        where: { id: proof.userId },
        data: { passwordHash, authVersion: { increment: 1 } },
      });
      await tx.session.updateMany({
        where: { userId: proof.userId, revokedAt: null },
        data: { revokedAt: new Date() },
      });
      await this.repo.audit(
        "password-reset",
        "success",
        requestId,
        proof.userId,
        undefined,
        tx,
      );
      return updated;
    });
    await this.delivery.notify(user.recoveryDestination ?? user.phone);
  }
  async change(
    auth: AuthContext,
    currentPassword: string,
    password: string,
    requestId: string,
  ) {
    if (!(await this.passwords.verify(auth.user.passwordHash, currentPassword)))
      throw new HttpError(401, "Invalid credentials");
    await this.passwords.validate(password);
    const passwordHash = await this.passwords.hash(password);
    await this.repo.transaction(async (tx) => {
      await this.repo.lockUser(tx, auth.user.id);
      const current = await tx.user.findUniqueOrThrow({
        where: { id: auth.user.id },
      });
      const session = await tx.session.findUniqueOrThrow({
        where: { id: auth.session.id },
      });
      if (
        !active(session, current) ||
        current.passwordHash !== auth.user.passwordHash
      )
        throw new HttpError(401, "Authentication required");
      await tx.user.update({
        where: { id: current.id },
        data: { passwordHash, authVersion: { increment: 1 } },
      });
      await tx.session.updateMany({
        where: { userId: current.id, revokedAt: null },
        data: { revokedAt: new Date() },
      });
      await this.repo.audit(
        "password-change",
        "success",
        requestId,
        current.id,
        undefined,
        tx,
      );
    });
    await this.delivery.notify(
      auth.user.recoveryDestination ?? auth.user.phone,
    );
  }
}
