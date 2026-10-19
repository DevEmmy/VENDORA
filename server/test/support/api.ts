import assert from "node:assert/strict";
import type { TestServer } from "./http";

export async function apiActor(harness: TestServer, label: string,
  inventoryMode: "RELATIONAL" | "SNAPSHOT" = "RELATIONAL") {
  const account = await harness.account(label);
  if (inventoryMode === "RELATIONAL")
    await harness.db.business.update({ where: { id: account.businessId }, data: { inventoryMode } });
  const response = await fetch(harness.url + "/api/auth/login", { method: "POST",
    headers: { "Content-Type": "application/json", origin: harness.url },
    body: JSON.stringify({ phone: account.phone, password: account.password }) });
  assert.equal(response.status, 200);
  const cookie = response.headers.getSetCookie().map(value => value.split(";")[0]).join("; ");
  return {
    ...account, cookie,
    async request<T>(path: string, method = "GET", body?: unknown, businessId = account.businessId) {
      const result = await fetch(harness.url + path, { method,
        headers: { cookie, origin: harness.url, "Content-Type": "application/json", "X-Business-ID": businessId },
        ...(body === undefined ? {} : { body: JSON.stringify(body) }) });
      return { status: result.status, data: await result.json() as T, headers: result.headers };
    },
  };
}
