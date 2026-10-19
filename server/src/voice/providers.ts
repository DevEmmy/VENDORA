import { randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { z } from "zod";
import type { VoiceConfig } from "../config/voice";
import { voicePolicy } from "../config/voice";

export interface SpeechToTextProvider {
  transcribe(
    audio: Buffer,
    mimeType: string,
    idempotencyKey: string,
  ): Promise<{ transcript: string; audioSeconds?: number; jobId?: string }>;
}
export interface TextToSpeechProvider {
  synthesize(
    text: string,
    idempotencyKey: string,
  ): Promise<{ audio: Buffer; contentType: string }>;
}
export interface LlmClient {
  complete(system: string, input: string): Promise<string>;
}
export const manualMessage =
  "Voice is temporarily unavailable. Use manual entry to update stock.";
export class VoiceError extends Error {
  constructor(
    public code: string,
    public traceId?: string,
  ) {
    super(manualMessage);
  }
}
export function voiceLog(
  stage: string,
  id: string,
  started: number,
  code?: string,
  traceId?: string,
) {
  // Deliberate allowlist: no provider messages, transcripts, raw audio or credentials.
  console.info(
    JSON.stringify({
      event: "voice",
      stage,
      voice_log_id: id,
      latency_ms: Date.now() - started,
      ...(code ? { error_code: code } : {}),
      ...(traceId ? { trace_id: traceId } : {}),
    }),
  );
}
type Fetch = typeof fetch;
const wait = (ms: number, signal: AbortSignal) =>
  new Promise<void>((done, reject) => {
    signal.throwIfAborted();
    const abort = () => {
      clearTimeout(timer);
      reject(new VoiceError("TIMEOUT"));
    };
    const timer = setTimeout(() => {
      signal.removeEventListener("abort", abort);
      done();
    }, ms);
    signal.addEventListener("abort", abort, { once: true });
  });
const object = (v: unknown): Record<string, unknown> =>
  v && typeof v === "object" ? (v as Record<string, unknown>) : {};

export class YarnGpt implements SpeechToTextProvider, TextToSpeechProvider {
  private voice: string | undefined;
  private initializing: Promise<void> | undefined;
  constructor(
    private config: VoiceConfig,
    private http: Fetch = fetch,
    private sleep: typeof wait = wait,
  ) {
    this.voice = config.YARNGPT_TTS_VOICE;
  }
  private async request(
    path: string,
    init: RequestInit,
    signal: AbortSignal,
  ): Promise<Response> {
    for (let attempt = 0; attempt < 2; attempt++) {
      let response: Response;
      try {
        response = await this.http(
          this.config.YARNGPT_BASE_URL.replace(/\/$/, "") + path,
          {
            ...init,
            signal,
            headers: {
              ...init.headers,
              Authorization: `Bearer ${this.config.YARNGPT_API_KEY}`,
            },
          },
        );
      } catch {
        if (signal.aborted) throw new VoiceError("TIMEOUT");
        if (!attempt) continue; // dropped connection: identical body and idempotency key
        throw new VoiceError("CONNECTION");
      }
      if (response.ok) return response;
      const envelope = object(await response.json().catch(() => ({})));
      const error = object(envelope.error);
      const redact = (value: string) =>
        [this.config.YARNGPT_API_KEY, this.config.LLM_API_KEY]
          .reduce<string>(
            (text, secret) =>
              secret ? text.replaceAll(secret, "[redacted]") : text,
            value,
          )
          .slice(0, 160);
      const code =
        typeof error.code === "string"
          ? redact(error.code)
          : `HTTP_${response.status}`;
      const trace =
        typeof error.trace_id === "string" ? redact(error.trace_id) : undefined;
      voiceLog(
        "provider_error",
        String(
          (init.headers && object(init.headers)["Idempotency-Key"]) ||
            "startup",
        ),
        Date.now(),
        code,
        trace,
      );
      if (response.status === 401)
        console.error(
          JSON.stringify({
            event: "voice_configuration_error",
            error_code: code,
            trace_id: trace,
          }),
        );
      if (response.status === 429 || code === "RATE_LIMITED") {
        const retry = response.headers.get("Retry-After");
        const delay =
          retry && /^\d+(\.\d+)?$/.test(retry)
            ? Number(retry) * 1000
            : Math.max(1000, Date.parse(retry || "") - Date.now() || 1000);
        if (!attempt) {
          await this.sleep(delay, signal);
          continue;
        }
      }
      if (response.status >= 500 && !attempt) continue;
      throw new VoiceError(code, trace);
    }
    throw new VoiceError("UNAVAILABLE");
  }
  initialize(): Promise<void> {
    return (this.initializing ??= (async () => {
      if (this.voice) return;
      try {
        const response = await this.request(
          "/api/v1/voices",
          {},
          AbortSignal.timeout(voicePolicy.ttsTimeoutMs),
        );
        const data: unknown = await response.json();
        // Log shape only, never arbitrary provider strings which could contain secrets.
        console.info(
          JSON.stringify({
            event: "voice_voices_shape",
            shape: Array.isArray(data)
              ? "array"
              : Object.keys(object(data)).filter((k) =>
                  /^[a-z_]{1,30}$/i.test(k),
                ),
          }),
        );
        const root = object(data);
        const nested = object(root.data);
        const voices = Array.isArray(data)
          ? data
          : (root.voices ?? root.data ?? nested.voices);
        const list = Array.isArray(voices) ? voices : nested.voices;
        const selected = Array.isArray(list)
          ? list.map(object).find((v) => v.default === true)
          : undefined;
        const id =
          selected?.id ??
          selected?.voice_id ??
          selected?.voice ??
          selected?.name;
        if (typeof id === "string") this.voice = id;
      } catch {
        /* Omit voice: YarnGPT uses its default. */
      }
    })());
  }
  async transcribe(audio: Buffer, mimeType: string, idempotencyKey: string) {
    z.string()
      .min(1)
      .max(64)
      .regex(/^[^:]+$/)
      .parse(idempotencyKey);
    const signal = AbortSignal.timeout(this.config.VOICE_ASR_TIMEOUT_MS);
    const form = new FormData();
    form.append(
      "file",
      new Blob([new Uint8Array(audio)], { type: mimeType }),
      mimeType.includes("mp4") ? "audio.m4a" : "audio",
    );
    const response = await this.request(
      "/api/v1/asr",
      {
        method: "POST",
        headers: { "Idempotency-Key": idempotencyKey },
        body: form,
      },
      signal,
    );
    if (response.status !== 202) throw new VoiceError("INVALID_ASR_RESPONSE");
    const jobSchema = z.object({
      job_id: z.string().min(1),
      audio_seconds: z.number().optional(),
    });
    let job = jobSchema.parse(await response.json());
    let delay = 1000;
    let retriedJob = false;
    for (;;) {
      await this.sleep(delay, signal);
      delay = Math.min(5000, delay * 1.5);
      const poll = await this.request(
        `/api/v1/asr/${encodeURIComponent(job.job_id)}`,
        {},
        signal,
      );
      const state = z
        .object({
          status: z.enum(["queued", "processing", "completed", "failed"]),
          transcript: z.string().nullable().optional(),
          audio_seconds: z.number().optional(),
          error_code: z.string().nullable().optional(),
          error_message: z.string().nullable().optional(),
          audio_available: z.boolean().optional(),
          trace_id: z.string().optional(),
        })
        .parse(await poll.json());
      if (state.status === "completed")
        return {
          transcript: state.transcript ?? "",
          jobId: job.job_id,
          ...((state.audio_seconds ?? job.audio_seconds) !== undefined
            ? { audioSeconds: (state.audio_seconds ?? job.audio_seconds)! }
            : {}),
        };
      if (state.status === "failed") {
        if (
          !retriedJob &&
          state.audio_available &&
          ["PROVIDER_ERROR", "PROVIDER_TIMEOUT"].includes(
            state.error_code || "",
          )
        ) {
          retriedJob = true;
          // There is no documented job-retry route. A failed reservation is refunded;
          // one new job uses a fresh key, keeping the same overall timeout budget.
          const retry = await this.request(
            "/api/v1/asr",
            {
              method: "POST",
              headers: { "Idempotency-Key": randomUUID() },
              body: form,
            },
            signal,
          );
          if (retry.status !== 202)
            throw new VoiceError("INVALID_ASR_RESPONSE");
          job = jobSchema.parse(await retry.json());
          continue;
        }
        throw new VoiceError(state.error_code || "ASR_FAILED", state.trace_id);
      }
    }
  }
  async synthesize(text: string, idempotencyKey: string) {
    z.string().min(1).max(5000).parse(text);
    await this.initialize();
    const response = await this.request(
      "/api/v1/streaming/conversation",
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "Idempotency-Key": idempotencyKey,
        },
        body: JSON.stringify({
          text,
          ...(this.voice ? { voice: this.voice } : {}),
          output_format: "mp3",
        }),
      },
      AbortSignal.timeout(voicePolicy.ttsTimeoutMs),
    );
    if (!response.headers.get("content-type")?.includes("audio/"))
      throw new VoiceError("INVALID_TTS_RESPONSE");
    const audio = Buffer.from(await response.arrayBuffer());
    if (audio.length < 128 || audio.length > voicePolicy.readbackCacheBytes)
      throw new VoiceError("INVALID_TTS_RESPONSE");
    return { audio, contentType: "audio/mpeg" };
  }
}

export class MockSpeech implements SpeechToTextProvider, TextToSpeechProvider {
  constructor(private transcript = "I sold 2 bags of rice") {}
  async transcribe() {
    return { transcript: this.transcript, audioSeconds: 2 };
  }
  async synthesize() {
    return {
      audio: readFileSync(resolve(__dirname, "../../fixtures/readback.mp3")),
      contentType: "audio/mpeg",
    };
  }
}

export class HttpLlm implements LlmClient {
  constructor(
    private config: VoiceConfig,
    private http: Fetch = fetch,
  ) {}
  async complete(system: string, input: string) {
    const c = this.config;
    const anthropic = c.LLM_PROVIDER === "anthropic";
    const base =
      c.LLM_BASE_URL ||
      (anthropic
        ? "https://api.anthropic.com/v1"
        : "https://api.openai.com/v1");
    let response: Response;
    try {
      response = await this.http(
        base.replace(/\/$/, "") +
          (anthropic ? "/messages" : "/chat/completions"),
        {
          method: "POST",
          signal: AbortSignal.timeout(c.VOICE_LLM_TIMEOUT_MS),
          headers: {
            "Content-Type": "application/json",
            ...(anthropic
              ? {
                  "x-api-key": c.LLM_API_KEY!,
                  "anthropic-version": "2023-06-01",
                }
              : { Authorization: `Bearer ${c.LLM_API_KEY}` }),
          },
          body: JSON.stringify({
            model: c.LLM_MODEL,
            ...(anthropic
              ? { temperature: 0, max_tokens: 2048 }
              : { max_completion_tokens: 2048 }),
            ...(anthropic
              ? { system, messages: [{ role: "user", content: input }] }
              : {
                  response_format: { type: "json_object" },
                  messages: [
                    { role: "system", content: system },
                    { role: "user", content: input },
                  ],
                }),
          }),
        },
      );
    } catch {
      throw new VoiceError("LLM_TIMEOUT_OR_CONNECTION");
    }
    if (!response.ok) {
      const body = object(await response.json().catch(() => ({})));
      const detail = object(body.error);

      console.error("voice-llm-rejected", {
        status: response.status,
        provider: c.LLM_PROVIDER,
        model: c.LLM_MODEL,
        type: detail.type,
        code: detail.code,
        param: detail.param,
      });

      throw new VoiceError(`LLM_HTTP_${response.status}`);
    }
    const body = object(await response.json());
    if (anthropic && Array.isArray(body.content))
      return body.content
        .map(object)
        .filter((v) => v.type === "text")
        .map((v) => String(v.text))
        .join("");
    const choices = body.choices;
    if (Array.isArray(choices))
      return String(object(object(choices[0]).message).content ?? "");
    throw new VoiceError("INVALID_LLM_RESPONSE");
  }
}
