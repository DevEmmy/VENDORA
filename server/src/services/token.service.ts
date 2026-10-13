import {
  createHash,
  randomBytes,
  randomUUID,
  timingSafeEqual,
} from "node:crypto";
import type { Config } from "../config/env";
import { HttpError } from "../middleware/error-handler";

export const opaque = () => randomBytes(32).toString("base64url");
export const digest = (value: string) =>
  createHash("sha256").update(value).digest("hex");
export function equal(a: string, b: string) {
  const aa = Buffer.from(a);
  const bb = Buffer.from(b);
  return aa.length === bb.length && timingSafeEqual(aa, bb);
}
export async function createTokens(config: Config) {
  const { importPKCS8, importSPKI, SignJWT, jwtVerify } = await import("jose");
  const privateKey = await importPKCS8(
    config.AUTH_PRIVATE_KEY.replace(/\\n/g, "\n"),
    "RS256",
  );
  const publicKey = await importSPKI(
    config.AUTH_PUBLIC_KEY.replace(/\\n/g, "\n"),
    "RS256",
  );
  // Refuse startup when the configured pair does not match.
  await jwtVerify(
    await new SignJWT({}).setProtectedHeader({ alg: "RS256" }).sign(privateKey),
    publicKey,
    { algorithms: ["RS256"] },
  );
  return {
    async sign(userId: string, sessionId: string) {
      return new SignJWT({ sid: sessionId })
        .setProtectedHeader({
          alg: "RS256",
          typ: "vendora-access+jwt",
          kid: config.AUTH_KEY_ID,
        })
        .setSubject(userId)
        .setIssuer(config.AUTH_ISSUER)
        .setAudience(config.AUTH_AUDIENCE)
        .setIssuedAt()
        .setExpirationTime("5m")
        .setJti(randomUUID())
        .sign(privateKey);
    },
    async verify(token: string) {
      try {
        const { payload, protectedHeader } = await jwtVerify(token, publicKey, {
          algorithms: ["RS256"],
          issuer: config.AUTH_ISSUER,
          audience: config.AUTH_AUDIENCE,
          typ: "vendora-access+jwt",
          requiredClaims: ["sub", "sid", "iat", "exp", "jti"],
          maxTokenAge: "5m",
        });
        if (
          protectedHeader.kid !== config.AUTH_KEY_ID ||
          typeof payload.sub !== "string" ||
          typeof payload.sid !== "string" ||
          !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(payload.sub) ||
          !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(payload.sid) ||
          typeof payload.jti !== "string" || payload.jti.length === 0 || payload.jti.length > 200
        )
          throw new Error("Invalid claims");
        return { userId: payload.sub, sessionId: payload.sid };
      } catch {
        throw new HttpError(401, "Authentication required");
      }
    },
  };
}
export type Tokens = Awaited<ReturnType<typeof createTokens>>;
