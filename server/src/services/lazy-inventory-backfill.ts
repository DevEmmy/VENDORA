import type { AuthRepository } from '../repositories/auth.repository';
import { backfillBusiness } from './inventory-backfill.service';

/** A migration failure must never turn valid credentials into a failed login. */
export async function lazyInventoryBackfill(repo: AuthRepository, userId: string, enabled: boolean) {
  if (!enabled) return [];
  const results: { businessId: string; status: string }[] = [];
  for (const member of await repo.memberships(userId)) {
    if (member.business.inventoryMode !== 'SNAPSHOT' || !member.permissions.includes('sales:write')) continue;
    try {
      const report = await backfillBusiness(repo.db, member.businessId, { actorId: userId });
      results.push({ businessId: member.businessId, status: report.status });
    } catch {
      // Do not expose malformed snapshot contents or connection details in auth.
      results.push({ businessId: member.businessId, status: 'unavailable' });
    }
  }
  return results;
}
