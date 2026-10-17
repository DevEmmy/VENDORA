import assert from 'node:assert/strict';
import test from 'node:test';
import type { Request, Response } from 'express';
import { cookiePolicy } from '../src/config/cookies';
import { createGuards } from '../src/middleware/auth';
import { HttpError } from '../src/middleware/error-handler';
import { schemas } from '../src/schemas/auth.schemas';
import { Passwords } from '../src/services/password.service';
import type { Sessions } from '../src/services/session.service';
import { config } from './helpers';
import { loadConfig } from '../src/config/env';
import { env } from './helpers';

test('cookie mutations require trusted Origin or same-site Fetch Metadata', () => {
  const policy = cookiePolicy(config);
  const guard = createGuards(config, policy, {} as Sessions).origin;
  const check = (headers: Record<string, string>, hasCookie = true) => {
    let error: unknown;
    const req = { get: (name: string) => headers[name.toLowerCase()], is: () => true,
      cookies: hasCookie ? { [policy.names.access]: 'credential' } : {} } as unknown as Request;
    guard(req, {} as Response, value => { error = value; });
    return error;
  };
  const missing = check({});
  assert(missing instanceof HttpError && missing.status === 403);
  assert.equal(check({ origin: config.origins[0]! }), undefined);
  assert.equal(check({ 'sec-fetch-site': 'same-origin' }), undefined);
  assert.equal(check({ 'sec-fetch-site': 'same-site' }), undefined);
  for (const headers of [{ origin: 'null' }, { 'sec-fetch-site': 'cross-site' },
    { origin: 'https://evil.test', 'sec-fetch-site': 'same-site' }]) assert(check(headers) instanceof HttpError);
  assert.equal(check({}, false), undefined); // Anonymous idempotent logout remains supported.
});

test('new credentials require eight characters and reject common passwords; legacy login remains allowed', async () => {
  const passwords = new Passwords();
  for (const password of ['seven77', 'password', 'Password123', '12345678', 'qwerty123']) {
    await assert.rejects(passwords.validate(password));
    assert.equal(schemas.change.safeParse({ currentPassword: 'old', password }).success, false);
  }
  await passwords.validate('market river 2026');
  assert(schemas.login.safeParse({ phone: '08030000000', password: 'secret' }).success);
  const oldHash = await passwords.hash('secret');
  assert(await passwords.verify(oldHash, 'secret'));
});

test('deployment diagnoses cross-site Strict cookies and supports an explicit same-site parent', () => {
  const invalid = loadConfig({ ...env, PUBLIC_API_ORIGIN: 'https://api.other.test', COOKIE_SITE_DOMAIN: 'vendora.test' });
  assert(invalid.cookieTopologyWarnings?.some(message => message.includes('same-site')));
  const valid = loadConfig({ ...env, PUBLIC_API_ORIGIN: 'https://api.vendora.test', COOKIE_SITE_DOMAIN: 'vendora.test' });
  assert.deepEqual(valid.cookieTopologyWarnings, []);
  const proxy = loadConfig({ ...env, PUBLIC_API_ORIGIN: 'https://vendora.test' });
  assert.deepEqual(proxy.cookieTopologyWarnings, []);
});
