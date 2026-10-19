import 'dotenv/config';
import { createHash } from 'node:crypto';
import { z } from 'zod';
import { createDatabase } from '../src/db/prisma';
import { loadConfig } from '../src/config/env';
import type { PrismaClient } from '../src/generated/prisma/client';
import type { InventoryActor } from '../src/types/inventory';
import { createProduct } from '../src/services/inventory.service';
import { inventorySchemas } from '../src/schemas/inventory.schemas';
import { voiceSeedProducts } from '../src/voice/catalog';

export async function seedVoiceProducts(db: PrismaClient, actor: InventoryActor) {
  for (const product of voiceSeedProducts) {
    // Stable operation ids preserve opening stock on subsequent seed runs.
    const hex = createHash('sha256').update(`voice-seed-v1:${actor.businessId}:${product.name}`).digest('hex');
    const clientId = `${hex.slice(0, 8)}-${hex.slice(8, 12)}-4${hex.slice(13, 16)}-8${hex.slice(17, 20)}-${hex.slice(20, 32)}`;
    await createProduct(db, actor, inventorySchemas.create.parse({ ...product, clientId, source: 'manual' }));
  }
}
async function main() {
  const getArg = (name: string) => {
    const idx = process.argv.indexOf(name);
    return idx >= 0 && idx + 1 < process.argv.length ? process.argv[idx + 1] : undefined;
  };
  const businessArg = getArg('--business');
  const userArg = getArg('--user');

  const db = createDatabase(loadConfig());
  try {
    let actor: InventoryActor;

    if (businessArg && userArg) {
      actor = { businessId: z.uuid().parse(businessArg), userId: z.uuid().parse(userArg) };
      const biz = await db.business.findUnique({ where: { id: actor.businessId } });
      if (biz && biz.inventoryMode !== 'RELATIONAL') {
        await db.business.update({ where: { id: actor.businessId }, data: { inventoryMode: 'RELATIONAL' } });
      }
    } else {
      // Auto-detect an active business with an eligible writer
      const eligible = await db.business.findFirst({
        where: { memberships: { some: { status: 'active', permissions: { has: 'sales:write' } } } },
        include: { memberships: { where: { status: 'active', permissions: { has: 'sales:write' } }, include: { user: true } } },
      });

      if (!eligible || !eligible.memberships.length) {
        const allBiz = await db.business.findMany({ include: { memberships: true }, take: 10 });
        console.error('No business with active "sales:write" membership found.');
        if (allBiz.length) {
          console.log('\nAvailable businesses in database:');
          for (const b of allBiz) {
            console.log(`- Business ID: ${b.id} (${b.businessName || b.phone}), Members: ${b.memberships.map(m => m.userId).join(', ')}`);
          }
          console.log('\nSpecify explicitly: npm run voice:seed -- --business <UUID> --user <UUID>');
        } else {
          console.log('\nNo businesses exist in the database yet. Create an account via web or provision one with provision-business.');
        }
        process.exitCode = 1;
        return;
      }

      if (eligible.inventoryMode !== 'RELATIONAL') {
        await db.business.update({ where: { id: eligible.id }, data: { inventoryMode: 'RELATIONAL' } });
      }

      actor = { businessId: eligible.id, userId: eligible.memberships[0]!.userId };
      console.log(`Auto-detected business "${eligible.businessName || eligible.phone}" (${actor.businessId}) and user (${actor.userId})`);
    }

    await seedVoiceProducts(db, actor);
    console.log('Voice catalog seeded successfully without resetting existing stock.');
  } finally {
    await db.$disconnect();
  }
}

if (require.main === module) {
  void main().catch((error: unknown) => {
    console.error('Voice seed failed:', error instanceof Error ? error.message : error);
    process.exitCode = 1;
  });
}
