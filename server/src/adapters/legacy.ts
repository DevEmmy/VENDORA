import type { Router } from "express";
export type RecordData = Record<string, unknown>;
export interface LegacyStore {
  data: {
    traders: Record<string, RecordData>;
    accounts: Record<string, RecordData>;
    paymentRequests: Record<string, RecordData>;
    loans: Record<string, RecordData>;
    credits: RecordData[];
    inbox: RecordData[];
    outbox: RecordData[];
  };
  save(): void;
}
export interface WhatsApp {
  send(phone: string, text: string): Promise<unknown>;
  handleText(phone: string, text: string): Promise<unknown>;
  handleWebhook(body: RecordData): Promise<unknown>;
  flushDue(now?: number): Promise<void>;
}
export interface Wema {
  router: Router;
}
// Narrow contracts isolate untyped CommonJS modules; no blanket any declaration.
export const legacy = {
  store: (require("../store") as { createStore(file?: string): LegacyStore })
    .createStore,
  whatsapp: (
    require("../whatsapp") as {
      createWhatsApp(store: LegacyStore, options?: RecordData): WhatsApp;
    }
  ).createWhatsApp,
  wema: (
    require("../wema") as {
      createWema(store: LegacyStore, options?: RecordData): Wema;
    }
  ).createWema,
  business: (
    require("../legacy-tts") as {
      createBusinessRouter(store: LegacyStore): Router;
    }
  ).createBusinessRouter,
  parse: (
    require("../parser") as {
      parse(text: string, context: RecordData): RecordData;
    }
  ).parse,
  applyOp: (
    require("../snapshot") as {
      applyOp(trader: RecordData, op: RecordData): void;
    }
  ).applyOp,
  answer: (
    require("../snapshot") as {
      answer(trader: RecordData, op: RecordData): string;
    }
  ).answer,
};
