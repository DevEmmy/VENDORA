import assert from "node:assert/strict";
import test from "node:test";
import { lagosDayRange, validCalendarDay } from "../src/services/lagos-time";

test("sales date boundaries use Lagos calendar days", () => {
  const range = lagosDayRange("2026-10-17");
  assert.equal(range.start.toISOString(), "2026-10-16T23:00:00.000Z");
  assert.equal(range.end.toISOString(), "2026-10-17T23:00:00.000Z");
  assert.equal(validCalendarDay("2026-02-30"), false);
  assert.equal(validCalendarDay("2024-02-29"), true);
});
