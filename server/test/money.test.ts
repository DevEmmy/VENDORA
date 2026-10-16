import assert from "node:assert/strict";
import test from "node:test";
import { nairaToKobo } from "../src/services/money";

test("naira conversion rounds browser floats to integer kobo", () => {
  assert.equal(nairaToKobo(0), 0n);
  assert.equal(nairaToKobo(0.1 + 0.2), 30n);
  assert.equal(nairaToKobo(19.999), 2000n);
  assert.equal(nairaToKobo(0.005), 1n);
  assert.equal(nairaToKobo(90_000_000_000), 9_000_000_000_000n);
});

test("naira conversion rejects invalid and unsafe values", () => {
  for (const amount of [-1, NaN, Infinity, -Infinity, Number.MAX_VALUE, Number.MAX_SAFE_INTEGER])
    assert.throws(() => nairaToKobo(amount), RangeError);
});
