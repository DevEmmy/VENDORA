import { Router } from 'express';
import type { AuthRepository } from '../repositories/auth.repository';
import { asyncRoute, HttpError } from '../middleware/error-handler';
import { pushSchema } from '../schemas/sync.schemas';
import { Authorization } from '../services/authorization.service';
import { executeSyncAction } from '../services/sync-action.service';

export function syncRoutes(repo: AuthRepository) {
  const router = Router();
  router.post('/api/sync/push', asyncRoute(async (req, res) => {
    const membership = await new Authorization(repo).business(req.auth!, 'sales:write', req.get('x-business-id'));
    const actor = { businessId: membership.businessId, userId: req.auth!.user.id };
    const parsed = pushSchema.safeParse(req.body);
    if (!parsed.success) throw new HttpError(400, 'Invalid sync batch', 'INVALID_INPUT');
    const results: { clientId: string; status: number; body: object }[] = [];
    let unavailable = false;
    for (const operation of parsed.data.operations) {
      if (unavailable) {
        results.push({ clientId: operation.body.clientId, status: 503,
          body: { error: 'Not attempted after an earlier temporary failure', code: 'RETRY_LATER' } });
        continue;
      }
      try {
        const outcome = await executeSyncAction(repo.db, actor, operation);
        const legacyMatched = 'legacyMatched' in outcome.result && outcome.result.legacyMatched === true;
        const created = operation.action === 'product.create' || operation.action === 'sale.create';
        results.push({ clientId: operation.body.clientId, status: created && !outcome.duplicate && !legacyMatched ? 201 : 200,
          body: { ...outcome.result, duplicate: outcome.duplicate } });
      } catch (error: unknown) {
        const known = error instanceof HttpError;
        const status = known ? error.status : 503;
        unavailable = status >= 500;
        results.push({ clientId: operation.body.clientId, status, body: {
          error: known ? error.message : 'Service unavailable', requestId: res.locals.requestId,
          ...(known && error.code ? { code: error.code } : {}), ...(known && error.details ? { details: error.details } : {}),
        } });
      }
    }
    // Each intent retains its own atomic transaction and receipt. A confirmed
    // rejection cannot erase unrelated physical operations later in the queue.
    res.json({ results });
  }));
  return router;
}
