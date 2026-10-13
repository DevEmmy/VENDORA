import type { Session, User } from "../generated/prisma/client";
import { HttpError } from "../middleware/error-handler";
import type { AuthRepository } from "../repositories/auth.repository";
import type { AuthContext } from "../types/auth";
import { digest, opaque, type Tokens } from "./token.service";

export const IDLE_MS = 30 * 60_000;
export const ABSOLUTE_MS = 7 * 24 * 60 * 60_000;
export function active(session: Session, user: User, now = Date.now()) {
  return (
    !session.revokedAt &&
    user.status === "active" &&
    session.authVersion === user.authVersion &&
    session.expiresAt.getTime() > now &&
    session.idleExpiresAt.getTime() > now
  );
}
export class Sessions {
  constructor(
    private repo: AuthRepository,
    private tokens: Tokens,
  ) {}
  async create(user: User, requestId: string) {
    const refresh = opaque();
    const now = new Date();
    const session = await this.repo.transaction(async (tx) => {
      await this.repo.lockUser(tx, user.id);
      const current = await tx.user.findUniqueOrThrow({
        where: { id: user.id },
      });
      if (
        current.authVersion !== user.authVersion ||
        current.status !== "active"
      )
        throw new HttpError(401, "Invalid credentials");
      const created = await tx.session.create({
        data: {
          userId: user.id,
          authVersion: user.authVersion,
          // Retained for compatibility with the existing database schema.
          csrf: "",
          idleExpiresAt: new Date(now.getTime() + IDLE_MS),
          expiresAt: new Date(now.getTime() + ABSOLUTE_MS),
          tokens: {
            create: {
              digest: digest(refresh),
              expiresAt: new Date(now.getTime() + ABSOLUTE_MS),
            },
          },
        },
      });
      await this.repo.audit(
        "login",
        "success",
        requestId,
        user.id,
        created.id,
        tx,
      );
      return created;
    });
    return {
      session,
      refresh,
      access: await this.tokens.sign(user.id, session.id),
    };
  }
  async authenticate(access: string, touch = true): Promise<AuthContext> {
    const claims = await this.tokens.verify(access);
    const session = await this.repo.db.session.findUnique({
      where: { id: claims.sessionId },
      include: { user: true },
    });
    if (
      !session ||
      session.userId !== claims.userId ||
      !active(session, session.user)
    )
      throw new HttpError(401, "Authentication required");
    if (touch) {
      const now = new Date();
      const result = await this.repo.db.session.updateMany({
        where: {
          id: session.id,
          revokedAt: null,
          idleExpiresAt: { gt: now },
          expiresAt: { gt: now },
          user: { status: "active", authVersion: session.authVersion },
        },
        data: {
          lastActivityAt: now,
          idleExpiresAt: new Date(
            Math.min(now.getTime() + IDLE_MS, session.expiresAt.getTime()),
          ),
        },
      });
      if (!result.count) throw new HttpError(401, "Authentication required");
    }
    return { session, user: session.user };
  }
  async binding(refresh: string, allowConsumed = false): Promise<AuthContext> {
    const token = await this.repo.db.refreshToken.findUnique({
      where: { digest: digest(refresh) },
      include: { session: { include: { user: true } } },
    });
    if (
      !token ||
      (!allowConsumed && token.consumedAt) ||
      token.expiresAt.getTime() <= Date.now() ||
      !active(token.session, token.session.user)
    )
      throw new HttpError(401, "Authentication required");
    return { session: token.session, user: token.session.user };
  }
  async rotate(refresh: string, requestId: string) {
    const next = opaque();
    // Return replay errors outside the transaction so revocation is committed.
    const result = await this.repo.transaction(async (tx) => {
      const prior = await tx.refreshToken.findUnique({
        where: { digest: digest(refresh) },
      });
      if (!prior) return null;
      await this.repo.lockSession(tx, prior.sessionId);
      const token = await tx.refreshToken.findUniqueOrThrow({
        where: { digest: prior.digest },
        include: { session: { include: { user: true } } },
      });
      const { session } = token;
      if (token.consumedAt) {
        await tx.session.update({
          where: { id: session.id },
          data: { revokedAt: new Date() },
        });
        await this.repo.audit(
          "refresh",
          "replay",
          requestId,
          session.userId,
          session.id,
          tx,
        );
        return null;
      }
      if (
        !active(session, session.user) ||
        token.expiresAt.getTime() <= Date.now()
      )
        return null;
      const consumed = await tx.refreshToken.updateMany({
        where: { digest: token.digest, consumedAt: null },
        data: { consumedAt: new Date() },
      });
      if (consumed.count !== 1) return null;
      await tx.refreshToken.create({
        data: {
          digest: digest(next),
          parentDigest: token.digest,
          sessionId: session.id,
          expiresAt: session.expiresAt,
        },
      });
      return session;
    });
    if (!result) throw new HttpError(401, "Authentication required");
    return {
      session: result,
      refresh: next,
      access: await this.tokens.sign(result.userId, result.id),
    };
  }
  async revoke(sessionId: string, requestId: string) {
    await this.repo.transaction(async (tx) => {
      await tx.session.updateMany({
        where: { id: sessionId, revokedAt: null },
        data: { revokedAt: new Date() },
      });
      await this.repo.audit(
        "logout",
        "success",
        requestId,
        undefined,
        sessionId,
        tx,
      );
    });
  }
  async revokeAll(userId: string, requestId: string) {
    await this.repo.transaction(async (tx) => {
      await this.repo.lockUser(tx, userId);
      await tx.user.update({
        where: { id: userId },
        data: { authVersion: { increment: 1 } },
      });
      await tx.session.updateMany({
        where: { userId, revokedAt: null },
        data: { revokedAt: new Date() },
      });
      await this.repo.audit(
        "logout-all",
        "success",
        requestId,
        userId,
        undefined,
        tx,
      );
    });
  }
}
