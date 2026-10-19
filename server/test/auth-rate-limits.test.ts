import assert from 'node:assert/strict';
import test from 'node:test';
import express from 'express';
import { createAuthRoutes } from '../src/routes/auth.routes';
import { errorHandler, HttpError } from '../src/middleware/error-handler';
import { config } from './helpers';

test('login, signup, refresh and reset deny exhausted rate limits before credential work', async () => {
  let blockedPrefix = 'auth:ip:';
  const calls: { key: string; limit: number; window: number }[] = [];
  const limiter = { async take(key: string, limit: number, window: number) {
    calls.push({ key, limit, window });
    if (key.startsWith(blockedPrefix)) throw new HttpError(429, 'Please try again later');
  } };
  const deps = { config, limiter } as unknown as Parameters<typeof createAuthRoutes>[0];
  const app = express();
  app.use(express.json(), createAuthRoutes(deps).router, errorHandler);
  const server = app.listen(0);
  await new Promise<void>(done => server.once('listening', done));
  const address = server.address(); assert(address && typeof address !== 'string');
  const send = (path: string, body: object) => fetch(`http://127.0.0.1:${address.port}${path}`, {
    method: 'POST', headers: { 'Content-Type': 'application/json', origin: config.origins[0]! }, body: JSON.stringify(body),
  });
  try {
    for (const path of ['/login', '/register', '/refresh', '/password/reset']) assert.equal((await send(path, {})).status, 429);
    assert(calls.every(call => call.limit === 60 && call.window === 60));
    for (const scenario of [
      { path: '/login', prefix: 'auth:login:', limit: 10, body: { phone: '08030000000', password: 'old' } },
      { path: '/register', prefix: 'auth:register:', limit: 5,
        body: { phone: '08030000000', password: 'market river 2026', name: 'Trader', businessName: 'Trader shop' } },
      { path: '/password/reset', prefix: 'reset:', limit: 5, body: { token: 'a'.repeat(43), password: 'market river 2026' } },
    ]) {
      blockedPrefix = scenario.prefix; calls.length = 0;
      assert.equal((await send(scenario.path, scenario.body)).status, 429);
      assert(calls.some(call => call.key.startsWith(scenario.prefix) && call.limit === scenario.limit && call.window === 900));
    }
  } finally { await new Promise<void>(done => server.close(() => done())); }
});
