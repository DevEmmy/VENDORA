import "dotenv/config";
import { createDelivery } from "./adapters/delivery";
import { createDeliveryQueue } from "./adapters/delivery-queue";
import { createApp } from "./app";
import { loadConfig } from "./config/env";
import { createDatabase } from "./db/prisma";
import { createLimiter } from "./middleware/rate-limit";
import { AuthRepository } from "./repositories/auth.repository";
import { Passwords } from "./services/password.service";
import { createTokens } from "./services/token.service";
import { createWebhookWorker } from "./services/webhook.service";
import { logAvailability } from "./services/audit.service";
import { startupHint, type StartupStage } from "./services/startup-diagnostics";

let startupStage: StartupStage = "configuration";

async function main() {
  const config = loadConfig();
  startupStage = "database";
  const db = createDatabase(config);
  startupStage = "Redis";
  const { client, limiter } = createLimiter(config.REDIS_URL);
  try {
    startupStage = "signing keys";
    const tokens = await createTokens(config);
    startupStage = "database";
    await db.$connect();
    await db.$queryRaw`SELECT 1`;
    await db.user.findFirst({ select: { id: true } });
    startupStage = "Redis";
    await client.connect();
    await client.ping();
    startupStage = "application";
    const repo = new AuthRepository(db);
    const queue = createDeliveryQueue(repo, config, createDelivery(config));
    const processWebhook = config.whatsappEnabled
      ? createWebhookWorker(repo, queue)
      : async () => {};
    const app = createApp({
      config,
      repo,
      limiter,
      passwords: new Passwords(),
      tokens,
      delivery: queue.delivery,
    });
    startupStage = "HTTP listener";
    const server = app.listen(config.PORT);
    await new Promise<void>((resolve, reject) => {
      const onListening = () => { server.off("error", onError); resolve(); };
      const onError = (error: Error) => { server.off("listening", onListening); reject(error); };
      server.once("listening", onListening);
      server.once("error", onError);
    });
    console.log(`Vendora listening on port ${config.PORT}`);
    // Legacy channel timers require a single worker; no uncoordinated replica-local flush loop.
    let stopping = false;
    let draining: Promise<void> | undefined;
    const jobs = setInterval(() => {
      if (!draining && !stopping)
        draining = processWebhook()
          .catch((error: unknown) => {
            logAvailability("worker-unavailable", undefined, {
              operation: "webhook-processing",
              hint: startupHint("database", error),
            });
          })
          .then(() => queue.drain().catch((error: unknown) => {
            logAvailability("worker-unavailable", undefined, {
              operation: "message-delivery",
              hint: startupHint("delivery", error),
            });
          }))
          .finally(() => {
            draining = undefined;
          });
    }, 1000);
    jobs.unref();
    const maintenance = setInterval(() => {
      void Promise.all([
        db.deliveryJob.deleteMany({ where: { expiresAt: { lt: new Date() } } })
          .catch((error: unknown) => {
            logAvailability("maintenance-unavailable", undefined, {
              operation: "delivery-cleanup",
              hint: startupHint("database", error),
            });
          }),
        // Keep consumed refresh digests until the family's absolute replay window ends.
        db.session.deleteMany({
          where: { expiresAt: { lt: new Date(Date.now() - 24 * 60 * 60_000) } },
        }).catch((error: unknown) => {
          logAvailability("maintenance-unavailable", undefined, {
            operation: "session-cleanup",
            hint: startupHint("database", error),
          });
        }),
      ]);
    }, 60_000);
    maintenance.unref();
    const shutdown = async () => {
      if (stopping) return;
      stopping = true;
      clearInterval(jobs);
      clearInterval(maintenance);
      const deadline = setTimeout(() => process.exit(1), 10_000);
      deadline.unref();
      await new Promise<void>((resolve) => server.close(() => resolve()));
      await draining;
      await db.$disconnect();
      if (client.isOpen) await client.quit();
      clearTimeout(deadline);
    };
    process.once("SIGTERM", () => {
      void shutdown();
    });
    process.once("SIGINT", () => {
      void shutdown();
    });
    server.on("error", () => {
      void shutdown().finally(() => process.exit(1));
    });
    process.once("uncaughtException", () => {
      void shutdown().finally(() => process.exit(1));
    });
    process.once("unhandledRejection", () => {
      void shutdown().finally(() => process.exit(1));
    });
  } catch (error) {
    await db.$disconnect();
    if (client.isOpen) client.destroy();
    throw error;
  }
}
void main().catch((error: unknown) => {
  console.error(`Backend startup failed at ${startupStage}: ${startupHint(startupStage, error)}`);
  process.exitCode = 1;
});
