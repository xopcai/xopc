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

export type MediaUnderstandingDecisionOutcome =
  | 'success'
  | 'failed'
  | 'skipped'
  | 'disabled'
  | 'no-attachment'
  | 'scope-deny';

export type MediaUnderstandingAttemptOutcome = 'success' | 'skipped' | 'failed';

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
}

export interface MediaUnderstandingModelDecision {
  provider?: string;
  model?: string;
  type: 'provider' | 'cli';
  outcome: MediaUnderstandingAttemptOutcome;
  reason?: string;
}

export interface MediaUnderstandingAttachmentDecision {
  attachmentIndex: number;
  attempts: MediaUnderstandingModelDecision[];
  chosen?: MediaUnderstandingModelDecision;
}

export interface MediaUnderstandingDecision {
  capability: MediaCapability;
  outcome: MediaUnderstandingDecisionOutcome;
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
  apiKey: string;
  baseUrl?: string;
  headers?: Record<string, string>;
  model?: string;
  language?: string;
  prompt?: string;
  query?: Record<string, string | number | boolean>;
  timeoutMs: number;
}

export interface AudioTranscriptionResult {
  text: string;
  model?: string;
  /** Provider-reported language (e.g. 'zh', 'en'). */
  language?: string;
  /** Audio duration in seconds, when reported. */
  durationSeconds?: number;
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

  /** Lower number = higher priority in auto-selection. */
  autoPriority?: Partial<Record<MediaCapability, number>>;

  /** True when the provider can natively ingest PDF (no OCR pre-step needed). */
  nativeDocumentInputs?: ReadonlyArray<'pdf'>;

  // Capability methods. Providers declare ONLY the ones they implement; absence
  // is the unambiguous "not supported" signal (no stub bodies, no NotImplemented).
  transcribeAudio?: (req: AudioTranscriptionRequest) => Promise<AudioTranscriptionResult>;
  describeImage?: (req: ImageDescriptionRequest) => Promise<ImageDescriptionResult>;
  describeVideo?: (req: VideoDescriptionRequest) => Promise<VideoDescriptionResult>;
}
