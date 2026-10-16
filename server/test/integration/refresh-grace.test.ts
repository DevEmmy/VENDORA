import assert from "node:assert/strict";
import test from "node:test";
import { AuthRepository } from "../../src/repositories/auth.repository";
import { Sessions } from "../../src/services/session.service";
import { createTokens, digest } from "../../src/services/token.service";
import { startTestServer } from "../support/http";

test("refresh grace tolerates only the immediately previous credential", { timeout: 180_000 }, async t => {
  const harness = await startTestServer();
  try {
    const account = await harness.account("Grace tests");
    const user = () => harness.db.user.findUniqueOrThrow({ where: { id: account.userId } });
    const tokens = await createTokens(harness.config);
    const sessions = new Sessions(new AuthRepository(harness.db), tokens);
    await t.test("concurrent refresh inside grace returns the same live successor", async () => {
      const original = await sessions.create(await user(), "grace-create");
      const results = await Promise.allSettled(Array.from({ length: 3 }, (_, index) =>
        sessions.rotate(original.refresh, `grace-race-${index}`)));
      const successful = results.filter(result => result.status === "fulfilled");
      console.log("M2 grace", JSON.stringify({ successful: successful.length }));
      assert.equal(successful.length, 3);
      const credentials = successful.map(result => result.value.refresh);
      assert.equal(new Set(credentials).size, 1);
      for (const result of successful) await sessions.authenticate(result.value.access);
      assert.equal((await harness.db.session.findUniqueOrThrow({ where: { id: original.session.id } })).revokedAt, null);
    });
    await t.test("reuse after the grace deadline revokes the family", async () => {
      const original = await sessions.create(await user(), "late-create");
      const current = await sessions.rotate(original.refresh, "late-rotate");
      await harness.db.refreshToken.update({ where: { digest: digest(original.refresh) },
        data: { consumedAt: new Date(Date.now() - 11_000) } });
      await assert.rejects(sessions.rotate(original.refresh, "late-reuse"), { status: 401 });
      await assert.rejects(sessions.authenticate(current.access), { status: 401 });
    });
    await t.test("an older ancestor revokes even inside the grace deadline", async () => {
      const first = await sessions.create(await user(), "ancestor-create");
      const second = await sessions.rotate(first.refresh, "ancestor-second");
      const third = await sessions.rotate(second.refresh, "ancestor-third");
      await sessions.authenticate(third.access);
      await assert.rejects(sessions.rotate(first.refresh, "ancestor-replay"), { status: 401 });
      await assert.rejects(sessions.authenticate(third.access), { status: 401 });
    });
    await t.test("logout-all still revokes a credential inside grace", async () => {
      const original = await sessions.create(await user(), "logout-create");
      const current = await sessions.rotate(original.refresh, "logout-rotate");
      await sessions.revokeAll(account.userId, "logout-all");
      await assert.rejects(sessions.rotate(original.refresh, "logout-replay"), { status: 401 });
      await assert.rejects(sessions.authenticate(current.access), { status: 401 });
    });
  } finally { await harness.stop(); }
});
