import assert from 'node:assert/strict';
import test from 'node:test';
import { createDatabase } from '../../src/db/prisma';
import { startTestServer } from '../support/http';

test('a busy one-connection pool waits past two seconds without losing a transaction', { timeout: 180000 }, async () => {
  const harness = await startTestServer();
  const db = createDatabase({ ...harness.config, DATABASE_POOL_MAX: 1 });
  let release = () => {}, ready = () => {};
  const readyPromise = new Promise<void>(resolve => { ready = resolve; });
  const releasePromise = new Promise<void>(resolve => { release = resolve; });
  try {
    const first = db.$transaction(async tx => {
      await tx.$queryRaw`SELECT 1`; ready(); await releasePromise;
    });
    await readyPromise;
    const started = Date.now();
    const second = db.$transaction(async tx => tx.$queryRaw<{ value: number }[]>`SELECT 2::int AS value`);
    // Attach rejection handling immediately so the pre-fix timeout is reported
    // as an assertion failure rather than an unhandled rejection.
    const results = Promise.all([first, second]);
    void results.catch(() => {});
    await new Promise<void>(resolve => setTimeout(resolve, 2600)); release();
    const [, rows] = await results;
    assert.equal(rows[0]!.value, 2); assert(Date.now() - started >= 2500);
  } finally { release(); await db.$disconnect(); await harness.stop(); }
});
