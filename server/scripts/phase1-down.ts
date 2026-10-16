import { connectDemo, down } from "./phase1-database";

async function main() {
  const client = await connectDemo();
  try {
    await down(client, new URL(process.env.DIRECT_URL!).searchParams.get("schema") ?? "public");
    console.log("Phase 1 down complete; auth tables retained.");
  } finally {
    await client.end();
  }
}
void main().catch((error: unknown) => { console.error(error); process.exitCode = 1; });
