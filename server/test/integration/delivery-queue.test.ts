import assert from 'node:assert/strict';
import test from 'node:test';
import { createDeliveryQueue } from '../../src/adapters/delivery-queue';
import { AuthRepository } from '../../src/repositories/auth.repository';
import { startTestServer } from '../support/http';
import { delivery } from '../helpers';

test('single-statement delivery claims are atomic, leased and UTC-safe', { timeout: 180000 }, async () => {
  const h = await startTestServer();
  try {
    const repo = new AuthRepository(h.db);
    let sent = 0;
    const queue = createDeliveryQueue(repo, h.config, { ...delivery, notify: async () => { sent++; } });
    assert.equal(await queue.drain(), false);
    await queue.delivery.notify('test-destination');
    await Promise.all([queue.drain(), queue.drain()]);
    assert.equal(sent, 1); assert.equal(await h.db.deliveryJob.count(), 0);
    const failing = createDeliveryQueue(repo, h.config, { ...delivery, notify: async () => { throw new Error('provider unavailable'); } });
    await failing.delivery.notify('test-destination');
    await assert.rejects(failing.drain());
    assert.equal(await failing.drain(), false);
    const job = await h.db.deliveryJob.findFirstOrThrow();
    assert.equal(job.attempts, 1); assert(job.leaseUntil && job.leaseUntil > new Date());
    await h.db.deliveryJob.update({ where: { id: job.id }, data: { leaseUntil: new Date(Date.now() - 1000) } });
    assert.equal(await queue.drain(), true); assert.equal(sent, 2);
    await queue.delivery.notify('expired');
    await h.db.deliveryJob.updateMany({ data: { expiresAt: new Date(Date.now() - 1000) } });
    assert.equal(await queue.drain(), false); assert.equal(sent, 2);
    // Run a claim through a non-UTC session while preserving the same transaction.
    await h.db.$transaction(async tx => {
      await tx.$executeRaw`SET LOCAL TIME ZONE 'Africa/Lagos'`;
      await tx.deliveryJob.deleteMany();
      const scoped = createDeliveryQueue(new AuthRepository(tx as typeof h.db), h.config, { ...delivery, notify: async () => { sent++; } });
      await scoped.delivery.notify('utc-test');
      assert.equal(await scoped.drain(), true);
    });
    assert.equal(sent, 3);
  } finally { await h.stop(); }
});
