import assert from 'node:assert/strict';
import test from 'node:test';
import { randomUUID } from 'node:crypto';
import { planSnapshotBackfill } from '../src/services/snapshot-backfill-plan';
import { backfillArguments } from '../scripts/inventory-backfill';

test('missing counts and null inventory block migration rather than silently inferring empty stock', () => {
  for (const state of [{ inventory: null }, { inventory: [{ id: 'p', name: 'Rice', price: 100 }] }]) {
    const plan = planSnapshotBackfill(state);
    assert(plan.issues.some(issue => issue.severity === 'error'));
  }
});
test('backfill CLI requires an explicit UUID business and preserves dry-run intent', () => {
  const businessId = randomUUID();
  assert.deepEqual(backfillArguments(['--business', businessId, '--dry-run']), { businessId, options: { dryRun: true } });
  assert.throws(() => backfillArguments([]));
  assert.throws(() => backfillArguments(['--business', 'legacy-id']));
  assert.throws(() => backfillArguments(['--all']));
});
