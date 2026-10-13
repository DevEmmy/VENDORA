import { createClient } from "redis";
import { digest } from "../services/token.service";
import { HttpError } from "./error-handler";

export interface Limiter {
  take(key: string, limit: number, windowSeconds: number): Promise<void>;
}
export function createLimiter(url: string) {
  const client = createClient({
    url,
    socket: { connectTimeout: 5000, reconnectStrategy: false },
    disableOfflineQueue: true,
  });
  client.on("error", () => {}); // Availability errors propagate through requests without logging secrets.
  const limiter: Limiter = {
    async take(key, limit, windowSeconds) {
      const count = await client.withCommandOptions({ abortSignal: AbortSignal.timeout(3000) }).eval(
        "local n = redis.call('INCR', KEYS[1]); if n == 1 then redis.call('EXPIRE', KEYS[1], ARGV[1]) end; return n",
        {
          keys: [`vendora:limit:${digest(key)}`],
          arguments: [String(windowSeconds)],
        },
      );
      if (Number(count) > limit)
        throw new HttpError(429, "Please try again later");
    },
  };
  return { client, limiter };
}
