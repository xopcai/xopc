/**
 * SpeechProviderPlugin contract — the unified TTS provider interface for xopc v2.
 *
 * Ported from openclaw/src/tts/provider-types.ts (commit baseline 2026-05-08), with
 * the following INTENTIONAL OMISSIONS per docs/voice-rearchitecture.md §2.3 / §15.3:
 *   - Telephony surface (synthesizeTelephony / SpeechTelephonySynthesisRequest)
 *   - Persona system (ResolvedTtsPersona / persona resolution context)
 *   - Talk-mode resolution (resolveTalkConfig / resolveTalkOverrides)
 *
 * DECISION: configType uses `Record<string, unknown>` rather than a generic
 * because xopc's config schema is dynamic per-provider and providers handle
 * their own zod validation in `resolveConfig`. This matches openclaw's runtime
 * behavior (they also fall through to `Record<string, unknown>` at the seam).
 */

import type { Config } from '../../config/schema.js';

/** Provider id, e.g. "openai", "alibaba", "edge", "minimax", "elevenlabs". */
export type SpeechProviderId = string;

/** Where the synthesized audio is going. xopc currently only emits "voice-note" + "audio-file". */
export type SpeechSynthesisTarget = 'audio-file' | 'voice-note';

/** Opaque per-provider configuration after `resolveConfig` has normalized it. */
export type SpeechProviderConfig = Record<string, unknown>;

/** Per-call overrides parsed from `[[tts:xxx=yyy]]` directives. */
export type SpeechProviderOverrides = Record<string, unknown>;

/** Whether the model can override TTS parameters via directives, and at what scope. */
export interface SpeechModelOverridePolicy {
  enabled: boolean;
  allowText: boolean;
  allowProvider: boolean;
  allowVoice: boolean;
  allowModelId: boolean;
  allowVoiceSettings: boolean;
  allowNormalization: boolean;
  allowSeed: boolean;
}

/** TTS directive token parse context handed to `parseDirectiveToken`. */
export interface SpeechDirectiveTokenParseContext {
  /** Lowercased directive key (e.g. "voice", "speed", "elevenlabs_voice"). */
  key: string;
  /** Raw value from `[[tts:key=value]]`. */
  value: string;
  /** Active model-override policy (provider must respect this). */
  policy: SpeechModelOverridePolicy;
  /** Provider id selected for this call (after directive `provider=` resolution). */
  selectedProvider?: SpeechProviderId;
  /** Provider's resolved config for this call (read-only here). */
  providerConfig?: SpeechProviderConfig;
  /** Overrides accumulated from previous tokens in the same directive block. */
  currentOverrides?: SpeechProviderOverrides;
}

/** Result of `parseDirectiveToken` — provider declares whether it handled the token. */
export interface SpeechDirectiveTokenParseResult {
  /** True when this provider claimed the token (orchestrator stops trying others). */
  handled: boolean;
  /** Patch to merge into accumulated overrides (e.g. `{ voice: 'alloy' }`). */
  overrides?: SpeechProviderOverrides;
  /** Non-fatal warnings (e.g. "voice override ignored: not in allowlist"). */
  warnings?: string[];
}

/** Audio output of a one-shot `synthesize` call. */
export interface SpeechSynthesisResult {
  audioBuffer: Buffer;
  /** Container/codec id, e.g. "mp3", "opus", "wav". */
  outputFormat: string;
  /** File extension WITHOUT the leading dot, e.g. "mp3". */
  fileExtension: string;
  /**
   * True when the buffer is directly playable as a Telegram voice note (opus/ogg)
   * or comparable. False = downstream may need ffmpeg compression.
   */
  voiceCompatible: boolean;
}

/** Streaming variant — chunks arrive as the provider produces them. */
export interface SpeechSynthesisStreamResult {
  audioStream: ReadableStream<Uint8Array>;
  outputFormat: string;
  fileExtension: string;
  voiceCompatible: boolean;
  /** Optional cleanup hook (close sockets, free temp files). Called once stream ends. */
  release?: () => Promise<void>;
}

export interface SpeechSynthesisRequest {
  text: string;
  cfg: Config;
  providerConfig: SpeechProviderConfig;
  target: SpeechSynthesisTarget;
  providerOverrides?: SpeechProviderOverrides;
  /** Hard timeout from the orchestrator (already merged with provider defaults). */
  timeoutMs: number;
}

export type SpeechSynthesisStreamRequest = SpeechSynthesisRequest;

/** Voice catalog entry returned by `listVoices`. */
export interface SpeechVoiceOption {
  id: string;
  name?: string;
  category?: string;
  description?: string;
  locale?: string;
  gender?: string;
  /** Provider-defined personality / style tags. */
  personalities?: string[];
}

export interface SpeechListVoicesRequest {
  cfg?: Config;
  providerConfig?: SpeechProviderConfig;
  apiKey?: string;
  baseUrl?: string;
}

export interface SpeechProviderResolveConfigContext {
  cfg: Config;
  /** Raw user-supplied config slice (e.g. `cfg.messages?.tts?.providers?.openai`). */
  rawConfig: Record<string, unknown>;
  timeoutMs: number;
}

export interface SpeechProviderConfiguredContext {
  cfg?: Config;
  providerConfig: SpeechProviderConfig;
  timeoutMs: number;
}

/**
 * The provider plugin interface. Every speech provider (whether bundled in xopc or
 * shipped from a user extension) implements this surface.
 *
 * DECISION: All methods except `id` and `resolveConfig` are optional. A provider
 * that only exposes `synthesize` is valid; orchestrator skips capabilities the
 * provider doesn't implement (no stub methods, no NotImplemented throws).
 */
export interface SpeechProviderPlugin {
  /** Canonical provider id. Must be unique within the registry. */
  id: SpeechProviderId;
  /**
   * Optional aliases (e.g. `["openai-tts"]` for back-compat with old config keys).
   * Aliases participate in lookup but `id` is the canonical persisted name.
   */
  aliases?: readonly string[];

  /**
   * Lower number = higher priority when auto-selecting providers (fallback disabled
   * or empty order). Matches OpenClaw `autoSelectOrder`.
   */
  autoSelectOrder?: number;

  /**
   * Normalize raw config → SpeechProviderConfig. Throws on validation error.
   * The returned object is opaque to the orchestrator and re-passed back into
   * `synthesize`, `synthesizeStream`, etc. via `request.providerConfig`.
   */
  resolveConfig(ctx: SpeechProviderResolveConfigContext): SpeechProviderConfig;

  /** Whether the provider can run (api key present, base url valid, etc.). */
  isConfigured(ctx: SpeechProviderConfiguredContext): boolean;

  /** One-shot synthesis. Required for any provider that wants to be callable. */
  synthesize?(req: SpeechSynthesisRequest): Promise<SpeechSynthesisResult>;

  /**
   * Streaming synthesis. When omitted, the orchestrator falls back to `synthesize`
   * + `wrapBufferAsStream` (single-chunk stream). See speak-core §8.1.
   */
  synthesizeStream?(req: SpeechSynthesisStreamRequest): Promise<SpeechSynthesisStreamResult>;

  /** Voice discovery for Web UI / CLI. Optional; orchestrator returns [] when missing. */
  listVoices?(req: SpeechListVoicesRequest): Promise<SpeechVoiceOption[]>;

  /**
   * Per-token directive parsing. Receives one `key=value` at a time. Provider
   * declares ownership via `handled: true`. Unhandled tokens fall through to
   * the next provider in the directive resolution chain (or are dropped).
   */
  parseDirectiveToken?(
    ctx: SpeechDirectiveTokenParseContext,
  ): SpeechDirectiveTokenParseResult;
}
