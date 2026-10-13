import { raw, Router } from "express";
import { createHmac } from "node:crypto";
import { z } from "zod";
import type { Config } from "../config/env";
import { asyncRoute, HttpError } from "../middleware/error-handler";
import type { AuthRepository } from "../repositories/auth.repository";
import { equal } from "../services/token.service";

const message = z
  .object({
    id: z.string().min(1).max(200),
    from: z.string().regex(/^[1-9]\d{9,14}$/),
    type: z.string(),
    text: z.object({ body: z.string().max(8000) }).optional(),
    audio: z.object({ id: z.string().max(200) }).optional(),
  })
  .passthrough();
const payload = z.object({
  entry: z
    .array(
      z.object({
        changes: z
          .array(
            z.object({
              value: z
                .object({ messages: z.array(message).max(100).optional() })
                .passthrough(),
            }),
          )
          .max(100),
      }),
    )
    .max(100),
});
export function webhookRoutes(config: Config, repo: AuthRepository) {
  const router = Router();
  router.get("/webhook", (req, res) => {
    if (!config.WA_VERIFY_TOKEN) {
      res.sendStatus(404);
      return;
    }
    if (
      req.query["hub.mode"] !== "subscribe" ||
      req.query["hub.verify_token"] !== config.WA_VERIFY_TOKEN ||
      typeof req.query["hub.challenge"] !== "string"
    ) {
      res.sendStatus(403);
      return;
    }
    res.type("text/plain").send(req.query["hub.challenge"]);
  });
  router.post(
    "/webhook",
    raw({ type: "application/json", limit: "256kb" }),
    asyncRoute(async (req, res) => {
      if (!config.WA_APP_SECRET) throw new HttpError(404, "Not found");
      if (!Buffer.isBuffer(req.body))
        throw new HttpError(400, "Invalid payload");
      const expected =
        "sha256=" +
        createHmac("sha256", config.WA_APP_SECRET)
          .update(req.body)
          .digest("hex");
      if (!equal(req.get("x-hub-signature-256") ?? "", expected))
        throw new HttpError(403, "Invalid provider signature");
      const result = payload.safeParse(JSON.parse(req.body.toString("utf8")));
      if (!result.success) throw new HttpError(400, "Invalid provider payload");
      // Persist a deduplicated durable inbox before acknowledging; a separate worker owns processing.
      for (const entry of result.data.entry)
        for (const change of entry.changes)
          for (const m of change.value.messages ?? []) {
            await repo.db.webhookEvent.createMany({
              data: {
                id: `whatsapp:${m.id}`,
                provider: "whatsapp",
                payload: JSON.parse(JSON.stringify(m)),
              },
              skipDuplicates: true,
            });
          }
      res.sendStatus(200);
    }),
  );
  return router;
}
