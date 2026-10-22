
import test from "node:test";
import assert from "node:assert/strict";

import {
  OFFLINE_ACCESS_DAYS,
  evaluateOfflineAccess,
} from "../src/features/security/offlineAccessPolicy.js";

const DAY_MS = 24 * 60 * 60 * 1000;
const NOW = Date.UTC(2026, 9, 20, 12, 0, 0);

test("allows offline access after recent verification", () => {
  const result = evaluateOfflineAccess(NOW - DAY_MS, NOW);

  assert.equal(OFFLINE_ACCESS_DAYS, 7);
  assert.equal(result.status, "allowed");
  assert.equal(result.allowed, true);
  assert.equal(result.remainingMs, 6 * DAY_MS);
});

test("warns when less than 24 hours remain", () => {
  const result = evaluateOfflineAccess(
    NOW - 6.5 * DAY_MS,
    NOW
  );

  assert.equal(result.status, "expiring");
  assert.equal(result.allowed, true);
  assert.equal(result.remainingMs, 0.5 * DAY_MS);
});

test("expires access exactly seven days after verification", () => {
  const result = evaluateOfflineAccess(
    NOW - 7 * DAY_MS,
    NOW
  );

  assert.equal(result.status, "expired");
  assert.equal(result.allowed, false);
  assert.equal(result.remainingMs, 0);
});

test("rejects missing and invalid verification timestamps", () => {
  for (const timestamp of [
    undefined,
    null,
    "",
    "2026-10-20",
    0,
    -1,
    NaN,
    Infinity,
  ]) {
    const result = evaluateOfflineAccess(timestamp, NOW);

    assert.equal(result.status, "expired");
    assert.equal(result.allowed, false);
  }
});

test("rejects verification timestamps in the future", () => {
  const result = evaluateOfflineAccess(NOW + 1000, NOW);

  assert.equal(result.status, "expired");
  assert.equal(result.allowed, false);
});

test("rejects invalid current timestamps", () => {
  const lastVerifiedAt = NOW - DAY_MS;

  for (const currentTime of [NaN, Infinity, -Infinity]) {
    const result = evaluateOfflineAccess(
      lastVerifiedAt,
      currentTime
    );

    assert.equal(result.status, "expired");
    assert.equal(result.allowed, false);
  }
});

test("allows access immediately before the deadline", () => {
  const result = evaluateOfflineAccess(
    NOW - 7 * DAY_MS + 1,
    NOW
  );

  assert.equal(result.status, "expiring");
  assert.equal(result.allowed, true);
  assert.equal(result.remainingMs, 1);
});
