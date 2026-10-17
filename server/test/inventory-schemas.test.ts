import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import test from "node:test";
import { inventorySchemas, kobo, quantity } from "../src/schemas/inventory.schemas";

test("quantity validation tolerates browser arithmetic noise without accepting fourth decimal places", () => {
  assert.equal(quantity.parse(0.1 + 0.2).toString(), "0.3");
  assert.equal(quantity.parse("0.125").toFixed(3), "0.125");
  assert.equal(quantity.safeParse("0.0001").success, false);
  assert.equal(quantity.safeParse(0.0001).success, false);
  assert.equal(quantity.safeParse("1000000000").success, false);
});

test("inventory inputs preserve kobo integers and reject direct quantity edits", () => {
  assert.equal(kobo.parse("9007199254740992"), 9007199254740992n);
  assert.equal(kobo.safeParse(9007199254740992).success, false);
  assert.equal(kobo.safeParse("9223372036854775808").success, false);
  for (const field of ["currentQty", "stockQty", "qty", "openingQty"])
    assert.equal(inventorySchemas.update.safeParse({ clientId: randomUUID(), [field]: "10" }).success, false);
});
