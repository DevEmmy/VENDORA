import assert from "node:assert/strict";
import test from "node:test";
import { cookiePolicy } from "../src/config/cookies";
import { Passwords } from "../src/services/password.service";
import { active } from "../src/services/session.service";
import { createTokens } from "../src/services/token.service";
import { config, identity } from "./helpers";

test("JWT verification rejects tampering and invalid claims", async () => {
  const tokens = await createTokens(config);
  const { user, session } = identity();
  const token = await tokens.sign(user.id, session.id);
  assert.deepEqual(await tokens.verify(token), {
    userId: user.id,
    sessionId: session.id,
  });
  const chunks = token.split(".");
  chunks[1] = Buffer.from(
    JSON.stringify({ sub: user.id, sid: session.id }),
  ).toString("base64url");
  await assert.rejects(tokens.verify(chunks.join(".")));
  await assert.rejects(tokens.verify("eyJhbGciOiJub25lIn0.eyJzdWIiOiJ1In0."));
  const { importPKCS8, SignJWT } = await import("jose");
  const key = await importPKCS8(config.AUTH_PRIVATE_KEY, "RS256");
  for (const invalid of [
    { issuer: "https://evil.test" },
    { audience: "wrong" },
    { type: "JWT" },
    { expiration: "-1m" },
    { kid: "untrusted" },
    { algorithm: "RS512" },
  ]) {
    const forged = await new SignJWT({ sid: session.id })
      .setProtectedHeader({
        alg: invalid.algorithm ?? "RS256",
        typ: invalid.type ?? "vendora-access+jwt",
        kid: invalid.kid ?? config.AUTH_KEY_ID,
      })
      .setSubject(user.id)
      .setIssuer(invalid.issuer ?? config.AUTH_ISSUER)
      .setAudience(invalid.audience ?? config.AUTH_AUDIENCE)
      .setIssuedAt()
      .setJti("test")
      .setExpirationTime(invalid.expiration ?? "5m")
      .sign(
        invalid.algorithm
          ? await importPKCS8(config.AUTH_PRIVATE_KEY, invalid.algorithm)
          : key,
      );
    await assert.rejects(tokens.verify(forged));
  }
});
test("session state enforces authoritative idle, absolute and account expiry", () => {
  const { user, session } = identity();
  assert(active(session, user));
  assert(!active({ ...session, idleExpiresAt: new Date(0) }, user));
  assert(!active({ ...session, expiresAt: new Date(0) }, user));
  assert(!active({ ...session, revokedAt: new Date() }, user));
  assert(!active(session, { ...user, authVersion: 1 }));
  assert(!active(session, { ...user, status: "suspended" }));
  assert(active(session, { ...user, phoneVerifiedAt: null }));
});
test("production cookies have host prefix and required security flags", () => {
  const policy = cookiePolicy(config);
  assert.equal(policy.names.access, "__Host-vendora-access");
  assert.deepEqual(policy.options, {
    secure: true,
    httpOnly: true,
    sameSite: "strict",
    path: "/",
  });
});
test("Argon2id preserves whitespace and Unicode without truncation", async () => {
  const passwords = new Passwords();
  const password = "  À very long password with spaces  ";
  const hash = await passwords.hash(password);
  assert(hash.startsWith("$argon2id$"));
  assert(await passwords.verify(hash, password));
  assert(!(await passwords.verify(hash, password.trim())));
  assert(!(await passwords.verify(undefined, password)));
});

test("password validation accepts simple passwords without network access", async () => {
  const passwords = new Passwords();
  await passwords.validate("secret");
  await passwords.validate("a".repeat(128));
  await assert.rejects(passwords.validate("short"));
  await assert.rejects(passwords.validate("a".repeat(129)));
});
