/**
 * MediaUnderstandingProvider contract — unified interface for STT (audio),
 * image description, and video description.
 *
 * Per docs/voice-rearchitecture.md §5:
 *   - All three capabilities (audio / image / video) have method signatures
 *     declared in this interface so future image-generation-rearchitecture.md
 *     plug-ins can register without touching the contract.
 *   - "Not implemented" means "method is not declared on the provider object" —
 *     the runner detects via `typeof provider.method === 'function'` and skips
 *     providers that don't implement the requested capability. There are NO
 *     stub method bodies, no NotImplemented throws.
 *   - xopc v2.0 only ships providers that implement `transcribeAudio`. Image /
 *     video providers will be added by a future RFC.
 *
 * Ported from openclaw/src/media-understanding/types.ts (commit baseline 2026-05-08),
 * stripped of openclaw-internal helpers (ActiveMediaModel, MsgContext, AuthProfileStore).
 */

import type { Config } from '../config/schema.js';

export type MediaCapability = 'image' | 'audio' | 'video';

/** One model entry in `tools.media.models` or `tools.media.audio.models`. */
export interface MediaUnderstandingModelEntry {
  provider?: string;
  model?: string;
  capabilities?: MediaCapability[];
  type?: 'provider' | 'cli';
  command?: string;
  baseUrl?: string;
  headers?: Record<string, string>;
  apiKey?: string;
  language?: string;
  prompt?: string;
  [key: string]: unknown;
}

export type MediaUnderstandingDecisionTask =
  | 'success'
  | 'failed'
  | 'skipped'
  | 'disabled'
  | 'no-attachment'
  | 'scope-deny';

export type MediaUnderstandingAttemptTask = 'success' | 'skipped' | 'failed';

export type MediaUnderstandingKind =
  | 'audio.transcription'
  | 'image.description'
  | 'video.description';

export interface MediaAttachment {
  /** Local filesystem path. Either `path` or `url` must be set. */
  path?: string;
  /** Remote URL (subject to SSRF policy when fetched). */
  url?: string;
  /** Reported MIME (best-effort, may be missing). */
  mime?: string;
  /** Stable index inside the originating message (preserved across runs). */
  index: number;
  /** True when an upstream pass already produced a transcript for this attachment. */
  alreadyTranscribed?: boolean;
}

/**
 * Pre-loaded attachment input handed to the runner. Caller is responsible for
 * fetching remote URLs (with SSRF guard) before invoking the runner.
 */
export interface CapabilityAttachmentInput {
  attachmentIndex: number;
  buffer: Buffer;
  fileName: string;
  mime?: string;
}

export interface MediaUnderstandingOutput {
  kind: MediaUnderstandingKind;
  attachmentIndex: number;
  text: string;
  provider: string;
  model?: string;
  language?: string;
  durationSeconds?: number;
}

export interface MediaUnderstandingModelDecision {
  provider?: string;
  model?: string;
  type: 'provider' | 'cli';
  task: MediaUnderstandingAttemptTask;
  reason?: string;
  /** Wall-clock time spent in this provider attempt. */
  latencyMs?: number;
}

export interface MediaUnderstandingAttachmentDecision {
  attachmentIndex: number;
  attempts: MediaUnderstandingModelDecision[];
  chosen?: MediaUnderstandingModelDecision;
}

export interface MediaUnderstandingDecision {
  capability: MediaCapability;
  task: MediaUnderstandingDecisionTask;
  attachments: MediaUnderstandingAttachmentDecision[];
}

export interface MediaUnderstandingResult {
  decision: MediaUnderstandingDecision;
  outputs: MediaUnderstandingOutput[];
}

// ---- Capability-specific request / result types --------------------------

export interface AudioTranscriptionRequest {
  buffer: Buffer;
  fileName: string;
  mime?: string;
  /** Optional for local/cli providers that do not use bearer auth. */
  apiKey?: string;
  baseUrl?: string;
  headers?: Record<string, string>;
  model?: string;
  language?: string;
  prompt?: string;
  query?: Record<string, string | number | boolean>;
  timeoutMs: number;
  signal?: AbortSignal;
}

export interface AudioTranscriptionResult {
  text: string;
  model?: string;
  /** Provider-reported language (e.g. 'zh', 'en'). */
  language?: string;
  /** Audio duration in seconds, when reported. */
  durationSeconds?: number;
}

export interface PcmAudioFormat {
  encoding: 'pcm_s16le';
  sampleRate: 16_000 | 24_000;
  channels: 1;
}

export interface StreamingSttCapabilities {
  inputSampleRates: readonly number[];
  turnDetection: readonly 'server_vad'[];
  defaultModel: string;
  models: readonly string[];
}

export type StreamingSttEvent =
  | { type: 'ready' }
  | { type: 'speech_started'; utteranceId: string }
  | { type: 'speech_stopped'; utteranceId: string }
  | { type: 'transcript_delta'; utteranceId: string; revision: number; text: string }
  | { type: 'transcript_final'; utteranceId: string; revision: number; text: string; language?: string }
  | { type: 'usage'; inputAudioMs: number }
  | { type: 'error'; error: Error };

export interface StreamingSttOpenRequest {
  model: string;
  inputFormat: PcmAudioFormat;
  apiKey?: string;
  baseUrl?: string;
  headers?: Record<string, string>;
  language?: string;
  prompt?: string;
  turnDetection: {
    mode: 'server_vad';
    silenceDurationMs: number;
  };
  timeoutMs: number;
  signal: AbortSignal;
  onEvent: (event: StreamingSttEvent) => void;
}

export interface StreamingSttSession {
  appendAudio(chunk: Uint8Array): void;
  commit(): Promise<void>;
  close(): Promise<void>;
  abort(reason: string): void;
}

export interface ImageDescriptionRequest {
  buffer: Buffer;
  fileName: string;
  mime?: string;
  prompt?: string;
  maxTokens?: number;
  timeoutMs: number;
  model: string;
  provider: string;
  cfg: Config;
}

export interface ImageDescriptionResult {
  text: string;
  model?: string;
}

export interface VideoDescriptionRequest {
  buffer: Buffer;
  fileName: string;
  mime?: string;
  apiKey: string;
  baseUrl?: string;
  headers?: Record<string, string>;
  model?: string;
  prompt?: string;
  timeoutMs: number;
}

export interface VideoDescriptionResult {
  text: string;
  model?: string;
}

// ---- Provider plugin contract -------------------------------------------

export interface MediaUnderstandingProvider {
  /** Canonical provider id (e.g. "openai", "alibaba", "gemini"). Must match
   *  the SpeechProviderPlugin id when the same vendor implements both. */
  id: string;

  /** Optional aliases for back-compat config strings. */
  aliases?: readonly string[];

  /** Capability subset declared explicitly. The runner ALSO probes via
   *  `typeof provider.transcribeAudio === 'function'` etc., so this field is
   *  primarily for UI / discovery. */
  capabilities?: MediaCapability[];

  /** Default model id per capability. */
  defaultModels?: Partial<Record<MediaCapability, string>>;

  /** Env var fallback when config slice has no apiKey (e.g. OPENAI_API_KEY). */
  envKey?: string;

  /**
   * When false, factory/runner do not require apiKey before invoking transcribeAudio.
   * Defaults to true.
   */
  requiresApiKey?: boolean;

  /** Optional runtime readiness check for bundled providers such as local STT. */
  isConfigured?: (options?: { model?: string }) => boolean;

  /** Lower number = higher priority in auto-selection. */
  autoPriority?: Partial<Record<MediaCapability, number>>;

  /** True when the provider can natively ingest PDF (no OCR pre-step needed). */
  nativeDocumentInputs?: ReadonlyArray<'pdf'>;

  // Capability methods. Providers declare ONLY the ones they implement; absence
  // is the unambiguous "not supported" signal (no stub bodies, no NotImplemented).
  transcribeAudio?: (req: AudioTranscriptionRequest) => Promise<AudioTranscriptionResult>;
  streamingAudio?: StreamingSttCapabilities;
  openAudioStream?: (req: StreamingSttOpenRequest) => Promise<StreamingSttSession>;
  describeImage?: (req: ImageDescriptionRequest) => Promise<ImageDescriptionResult>;
  describeVideo?: (req: VideoDescriptionRequest) => Promise<VideoDescriptionResult>;
}
