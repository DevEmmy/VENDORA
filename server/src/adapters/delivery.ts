import type { Config } from "../config/env";
import { HttpError } from "../middleware/error-handler";

export interface Delivery {
  sendVerification(destination: string, code: string): Promise<void>;
  sendRecovery(destination: string, token: string): Promise<void>;
  notify(destination: string): Promise<void>;
  sendMessage(destination: string, text: string): Promise<void>;
}
export function createDelivery(config: Config): Delivery {
  async function send(body: Record<string, string>) {
    if (!config.DELIVERY_URL || !config.DELIVERY_TOKEN)
      throw new HttpError(503, "Delivery unavailable");
    const response = await fetch(config.DELIVERY_URL, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${config.DELIVERY_TOKEN}`,
      },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(10_000),
      redirect: "error",
    });
    if (!response.ok) throw new HttpError(503, "Delivery unavailable");
  }
  return {
    sendVerification: (destination, code) =>
      send({ purpose: "phone-verification", destination, code }),
    sendRecovery: (destination, token) => {
      if (!config.RECOVERY_ORIGIN)
        throw new HttpError(503, "Recovery unavailable");
      return send({
        purpose: "password-recovery",
        destination,
        url: `${config.RECOVERY_ORIGIN}/reset-password#token=${token}`,
      });
    },
    notify: (destination) =>
      send({ purpose: "credential-change", destination }),
    sendMessage: (destination, text) =>
      send({ purpose: "whatsapp-reply", destination, text }),
  };
}
