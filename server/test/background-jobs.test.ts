import assert from 'node:assert/strict';
import test from 'node:test';
import { createBackgroundJobs } from '../src/services/background-jobs';

const enabled = { whatsappEnabled: false, DELIVERY_URL: 'https://delivery.test', DELIVERY_TOKEN: 'test-token' };
const flush = () => new Promise<void>(resolve => setImmediate(resolve));
test('unconfigured background services never touch the database', async () => {
  let calls = 0;
  const run = async () => { calls++; };
  const jobs = createBackgroundJobs({ whatsappEnabled: false }, { processWebhook: run, deliver: run, onError() {} });
  for (let i = 0; i < 10; i++) jobs.tick();
  await jobs.finish(); assert.equal(calls, 0);
});
test('idle delivery polling pauses and in-flight tasks never overlap', async () => {
  let calls = 0, clock = 0; let release = () => {};
  const jobs = createBackgroundJobs(enabled, { processWebhook: async () => {}, onError() {}, deliver: () => {
    calls++; return new Promise<boolean>(done => { release = () => done(false); });
  } }, () => clock);
  jobs.tick(); await flush(); jobs.tick(); await flush(); assert.equal(calls, 1);
  release(); await jobs.finish();
  clock = 4999; jobs.tick(); await flush(); assert.equal(calls, 1);
  clock = 5000; jobs.tick(); await flush(); assert.equal(calls, 2);
  release(); await jobs.finish();
});
test('worker failures back off and recover without blocking other services', async () => {
  let deliveries = 0, webhooks = 0, errors = 0, clock = 0;
  const jobs = createBackgroundJobs({ ...enabled, whatsappEnabled: true }, {
    processWebhook: async () => { webhooks++; },
    deliver: async () => { deliveries++; if (deliveries < 3) throw new Error('temporary'); return true; },
    onError: operation => { assert.equal(operation, 'message-delivery'); errors++; },
  }, () => clock);
  jobs.tick(); await jobs.finish(); assert.equal(deliveries, 1);
  clock = 1000; jobs.tick(); await jobs.finish(); assert.equal(deliveries, 1); assert.equal(webhooks, 2);
  clock = 2000; jobs.tick(); await jobs.finish(); assert.equal(deliveries, 2);
  clock = 5999; jobs.tick(); await jobs.finish(); assert.equal(deliveries, 2);
  clock = 6000; jobs.tick(); await jobs.finish(); assert.equal(deliveries, 3);
  clock = 7000; jobs.tick(); await jobs.finish(); assert.equal(deliveries, 4); assert.equal(errors, 2);
});
