import 'dotenv/config';
import { z } from 'zod';
import { loadConfig } from '../src/config/env';
import { createDatabase } from '../src/db/prisma';
import { backfillBusiness } from '../src/services/inventory-backfill.service';

export function backfillArguments(args: string[]) {
  let businessId: string | undefined, actorId: string | undefined, dryRun = false;
  for (let index = 0; index < args.length; index++) {
    const flag = args[index];
    if (flag === '--business') businessId = z.uuid().parse(args[++index]);
    else if (flag === '--actor') actorId = z.uuid().parse(args[++index]);
    else if (flag === '--dry-run') dryRun = true;
    else throw new Error('Use --business <UUID> [--actor <member UUID>] [--dry-run]');
  }
  if (!businessId) throw new Error('--business <UUID> is required');
  return { businessId, options: { dryRun, ...(actorId ? { actorId } : {}) } };
}

async function main() {
  if (!process.argv[1]?.endsWith('inventory-backfill.ts')) return;
  const { businessId, options } = backfillArguments(process.argv.slice(2));
  const db = createDatabase(loadConfig());
  try {
    const report = await backfillBusiness(db, businessId, options);
    console.log(JSON.stringify(report, null, 2));
    if (report.status === 'blocked') process.exitCode = 2;
  } finally { await db.$disconnect(); }
}
void main().catch((error: unknown) => {
  console.error(error instanceof z.ZodError ? 'Invalid command argument; use UUID business/member IDs.' :
    error instanceof Error && error.message.startsWith('--business') ? error.message :
      'Inventory backfill did not complete. Check configuration and database access; no partial business cutover was committed.');
  process.exitCode = 1;
});
