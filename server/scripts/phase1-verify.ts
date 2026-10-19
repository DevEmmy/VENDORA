import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import type { Client } from "pg";
import { connectDemo, demoBusiness } from "./phase1-database";

export async function reports(client: Client) {
  const sections = readFileSync(resolve("prisma/phase1-verification.sql"), "utf8").split("-- report: ").slice(1);
  for (const section of sections) {
    const newline = section.indexOf("\n");
    const title = section.slice(0, newline).trim();
    const result = await client.query(section.slice(newline + 1), [demoBusiness]);
    console.log(title);
    console.log(JSON.stringify(result.rows, null, 2));
  }
}

async function main() {
  if (process.argv[1]?.endsWith("phase1-verify.ts")) {
    const client = await connectDemo();
    try { await reports(client); } finally { await client.end(); }
  }
}
void main().catch((error: unknown) => { console.error(error); process.exitCode = 1; });
