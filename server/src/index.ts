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
import { VoiceService } from './voice/service';
import { createBackgroundJobs } from './services/background-jobs';

let startupStage: StartupStage = "configuration";

// On Render the site and API share the service's own https address, so fill in the
// address-based settings from it unless they were set by hand.
function useRenderAddress() {
  const own = process.env.RENDER_EXTERNAL_URL?.replace(/\/+$/, "");
  if (!own) return;
  for (const key of ["AUTH_ISSUER", "CORS_ORIGINS", "PUBLIC_API_ORIGIN"])
    if (!process.env[key]) process.env[key] = own;
}

async function main() {
  useRenderAddress();
  const config = loadConfig();
  for (const warning of config.cookieTopologyWarnings) console.warn(`Cookie configuration: ${warning}`);
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
    const voice = new VoiceService(db, config);
    await voice.initialize();
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
      voice,
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
    const background = createBackgroundJobs(config, {
      processWebhook,
      deliver: () => queue.drain(),
      onError: (operation, error) => logAvailability('worker-unavailable', undefined, {
        operation, hint: startupHint(operation === 'message-delivery' ? 'delivery' : 'database', error),
      }),
    });
    const jobs = setInterval(() => {
      if (!stopping) background.tick();
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
      await background.finish();
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
