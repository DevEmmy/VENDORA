import type { Config } from '../config/env';

type Operation = 'webhook-processing' | 'message-delivery';
interface Jobs {
  processWebhook(): Promise<unknown>;
  deliver(): Promise<unknown>;
  onError(operation: Operation, error: unknown): void;
}

export function createBackgroundJobs(config: Pick<Config, 'whatsappEnabled' | 'DELIVERY_URL' | 'DELIVERY_TOKEN'>,
  jobs: Jobs, now = Date.now) {
  function task(operation: Operation, run: () => Promise<unknown>) {
    let running: Promise<void> | undefined;
    let nextAttempt = 0, failures = 0;
    return {
      tick() {
        if (running || now() < nextAttempt) return running;
        running = Promise.resolve().then(run).then(result => {
          failures = 0;
          nextAttempt = now() + (result === false ? 5000 : 1000);
        }).catch((error: unknown) => {
          failures++;
          nextAttempt = now() + Math.min(30000, 1000 * 2 ** Math.min(failures, 5));
          jobs.onError(operation, error);
        }).finally(() => { running = undefined; });
        return running;
      },
      finish: () => running,
    };
  }
  const tasks: ReturnType<typeof task>[] = [];
  if (config.whatsappEnabled) tasks.push(task('webhook-processing', jobs.processWebhook));
  // An unconfigured delivery gateway cannot send anything. Preserve queued jobs
  // for normal expiry without spending a database transaction on every tick.
  if (config.DELIVERY_URL && config.DELIVERY_TOKEN) tasks.push(task('message-delivery', jobs.deliver));
  return {
    tick() { for (const worker of tasks) void worker.tick(); },
    async finish() { await Promise.all(tasks.map(worker => worker.finish())); },
  };
}
