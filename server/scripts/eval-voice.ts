import "dotenv/config";
import { readFile } from "node:fs/promises";
import { globSync } from "node:fs";
import { resolve, extname } from "node:path";
import { randomUUID } from "node:crypto";
import { z } from "zod";
import { voiceSchema, validateVoice } from "../src/config/voice";
import { HttpLlm, YarnGpt } from "../src/voice/providers";
import {
  MockLlm,
  normalize,
  resolveCommand,
  VoiceParser,
} from "../src/voice/parser";
import { voiceSeedProducts } from "../src/voice/catalog";

const fixtureSchema = z.array(
  z.object({
    transcript: z.string(),
    action: z.enum(["sale", "restock", "adjustment", "unknown"]),
    items: z.array(z.object({ item: z.string(), quantity: z.number() })),
    status: z.string().optional(),
  }),
);
const words = (value: string) =>
  value
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, "")
    .split(/\s+/)
    .filter(Boolean);
function editDistance(a: string[], b: string[]) {
  const row = Array.from({ length: b.length + 1 }, (_, i) => i);
  for (let i = 1; i <= a.length; i++) {
    let diagonal = row[0]!;
    row[0] = i;
    for (let j = 1; j <= b.length; j++) {
      const old = row[j]!;
      row[j] = Math.min(
        old + 1,
        row[j - 1]! + 1,
        diagonal + Number(a[i - 1] !== b[j - 1]),
      );
      diagonal = old;
    }
  }
  return row[b.length]!;
}
async function main() {
  const live = process.argv.includes("--live");
  const clipIndex = process.argv.indexOf("--transcribe");
  const fixtures = fixtureSchema.parse(
    JSON.parse(
      await readFile(resolve(__dirname, "../eval/phrases.json"), "utf8"),
    ),
  );
  const products = voiceSeedProducts.map((p, i) => ({
    ...p,
    id: `e0000000-0000-4000-8000-${String(i + 1).padStart(12, "0")}`,
  }));
  const clips =
    clipIndex >= 0
      ? process.argv
          .slice(clipIndex + 1)
          .filter((arg) => arg !== "--live")
          .flatMap((pattern) => globSync(pattern))
      : [];
  if (clipIndex >= 0 && !live)
    throw new Error("--transcribe requires --live; real STT costs credits.");
  if (clipIndex >= 0 && !clips.length)
    throw new Error("No clips matched the supplied paths/globs.");
  console.log(
    live
      ? `LIVE opt-in: estimated ${clipIndex >= 0 ? clips.length : fixtures.length} initial paid calls (JSON repair/transport retries may add calls).`
      : `MOCK evaluation: ${fixtures.length} fixtures, no external calls.`,
  );
  const config = voiceSchema.parse(
    Object.fromEntries(
      Object.entries({
        ...process.env,
        VOICE_MOCK_MODE: live ? "false" : "true",
      }).filter(([, v]) => v !== ""),
    ),
  );
  if (live && clipIndex < 0) validateVoice(config);
  if (live && clipIndex >= 0 && !config.YARNGPT_API_KEY)
    throw new Error("YARNGPT_API_KEY is required.");
  if (clipIndex >= 0) {
    const stt = new YarnGpt(config);
    const latencies: number[] = [];
    let errors = 0,
      totalWords = 0,
      totalDistance = 0,
      scored = 0;
    for (const clip of clips) {
      const expected = await readFile(
        clip.replace(/\.[^.]+$/, ".txt"),
        "utf8",
      ).catch(() => null);
      const mime =
        (
          {
            ".webm": "audio/webm",
            ".wav": "audio/wav",
            ".mp3": "audio/mpeg",
            ".mp4": "audio/mp4",
            ".m4a": "audio/mp4",
            ".ogg": "audio/ogg",
          } as Record<string, string>
        )[extname(clip)] || "audio/webm";
      const started = Date.now();
      try {
        const result = await stt.transcribe(
          await readFile(clip),
          mime,
          randomUUID(),
        );
        const ms = Date.now() - started;
        latencies.push(ms);
        if (expected !== null) {
          const reference = words(expected);
          const distance = editDistance(reference, words(result.transcript));
          totalWords += reference.length;
          totalDistance += distance;
          scored++;
          console.log(
            JSON.stringify({
              clip,
              latency_ms: ms,
              word_error_rate: distance / Math.max(1, reference.length),
            }),
          );
        } else
          console.log(
            JSON.stringify({
              clip,
              latency_ms: ms,
              accuracy: "unscored: add a sibling .txt transcript",
            }),
          );
      } catch {
        errors++;
        console.log(
          JSON.stringify({
            clip,
            error: "STT failed",
            latency_ms: Date.now() - started,
          }),
        );
      }
    }
    latencies.sort((a, b) => a - b);
    const percentile = (p: number) =>
      latencies[Math.max(0, Math.ceil(p * latencies.length) - 1)] ?? null;
    console.log(
      JSON.stringify({
        clips: clips.length,
        errors,
        scored,
        p50_ms: percentile(0.5),
        p95_ms: percentile(0.95),
        word_accuracy: scored
          ? Math.max(0, 1 - totalDistance / Math.max(1, totalWords))
          : null,
      }),
    );
    return;
  }
  const parser = new VoiceParser(live ? new HttpLlm(config) : new MockLlm());
  const counts = { action: 0, item: 0, quantity: 0, end_to_end: 0 };
  let failures = 0;
  for (const expected of fixtures) {
    try {
      const parsed = await parser.parse(expected.transcript, products);
      const resolved = resolveCommand(parsed, products);
      const action = parsed.action === expected.action;
      const item =
        parsed.items.length === expected.items.length &&
        parsed.items.every(
          (value, i) =>
            normalize(value.spoken_name) === normalize(expected.items[i]!.item),
        );
      const quantity =
        parsed.items.length === expected.items.length &&
        parsed.items.every(
          (value, i) => value.quantity === expected.items[i]!.quantity,
        );
      counts.action += Number(action);
      counts.item += Number(item);
      counts.quantity += Number(quantity);
      const correct =
        action &&
        item &&
        quantity &&
        (!expected.status || resolved.status === expected.status);
      counts.end_to_end += Number(correct);
      if (!correct)
        console.log(
          JSON.stringify({
            transcript: expected.transcript,
            expected,
            actual: parsed,
            status: resolved.status,
          }),
        );
    } catch {
      failures++;
    }
  }
  console.log(
    JSON.stringify(
      {
        examples: fixtures.length,
        failures,
        accuracy: Object.fromEntries(
          Object.entries(counts).map(([key, value]) => [
            key,
            value / fixtures.length,
          ]),
        ),
      },
      null,
      2,
    ),
  );
}
void main().catch((error) => {
  console.error(
    error instanceof Error &&
      /--transcribe|No clips|_API_KEY/.test(error.message)
      ? error.message
      : "Evaluation failed. Check configuration and fixtures.",
  );
  process.exitCode = 1;
});
