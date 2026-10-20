import 'dotenv/config';
import { createDatabase } from '../src/db/prisma';
import { loadConfig } from '../src/config/env';

async function main() {
  const db = createDatabase(loadConfig());
  try {
    const users = await db.user.findMany({
      take: 10,
      include: { memberships: { include: { business: true } } }
    });
    console.log(`Found ${users.length} users:`);
    for (const u of users) {
      console.log(`- Phone: "${u.phone}", Name: "${u.name}", Status: "${u.status}", Businesses: ${u.memberships.map(m => m.business.businessName || m.business.phone).join(', ')}`);
    }
  } finally {
    await db.$disconnect();
  }
}
main().catch(console.error);

