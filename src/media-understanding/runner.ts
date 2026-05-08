/**
 * MediaUnderstanding capability runner.
 *
 * Orchestrates per-attachment fallback across providers for one capability
 * (audio / image / video). For each attachment:
 *   1. Build the candidate provider list from the registry, ordered by
 *      autoPriority (lower = first), with caller-supplied `providerOrder`
 *      overriding when set.
 *   2. Try providers in order. A provider is SKIPPED when it does not declare
 *      the requested capability OR does not implement the corresponding method.
 *   3. The first provider whose capability call resolves successfully wins;
 *      its output is recorded as `chosen`. Failures are recorded as attempts
 *      and the next provider is tried.
 *   4. When ALL providers for an attachment fail, the attachment outcome is
 *      `failed`; when no provider was even eligible (capability not registered),
 *      it's `disabled`.
 *
 * DECISION (per docs/voice-rearchitecture.md §5):
 *   - This is a thin runner only. xopc v2.0 ships ONLY audio; image/video
 *     branches exist as type-level fall-throughs (the runner happily handles
 *     them once a provider registers describeImage / describeVideo, but no
 *     image-specific helpers — like multi-image batching — live here yet).
 *   - We deliberately do NOT port openclaw's `MediaAttachmentCache` (which
 *     handles temp-file extraction, SSRF re-validation on remote URLs, etc.).
 *     For xopc v2.0 the caller is expected to pre-load the buffer; remote URL
 *     fetching is the caller's responsibility (typically the channel adapter
 *     does this before invoking the runner).
 */

import { createLogger } from '../utils/logger.js';

import { listProvidersForCapability } from './registry.js';
import type {
  AudioTranscriptionRequest,
  AudioTranscriptionResult,
  CapabilityAttachmentInput,
  ImageDescriptionRequest,
  ImageDescriptionResult,
  MediaCapability,
  MediaUnderstandingAttachmentDecision,
  MediaUnderstandingDecision,
  MediaUnderstandingKind,
  MediaUnderstandingModelDecision,
  MediaUnderstandingOutput,
  MediaUnderstandingProvider,
  MediaUnderstandingResult,
  VideoDescriptionRequest,
  VideoDescriptionResult,
} from './types.js';

const log = createLogger('MediaUnderstandingRunner');

export type { CapabilityAttachmentInput } from './types.js';

export interface RunCapabilityOptions {
  capability: MediaCapability;
  attachments: readonly CapabilityAttachmentInput[];
  /** Caller-supplied ordering. When set, overrides registry autoPriority. */
  providerOrder?: readonly string[];
  /**
   * Per-provider request builder. Returned shape MUST match the capability:
   *   audio  → AudioTranscriptionRequest
   *   image  → ImageDescriptionRequest
   *   video  → VideoDescriptionRequest
   * The runner does not synthesize api keys / urls — that's the caller's job
   * (typically reads from cfg.tools.media.audio.providers[providerId]).
   */
  buildRequest: (params: {
    provider: MediaUnderstandingProvider;
    attachment: CapabilityAttachmentInput;
  }) =>
    | AudioTranscriptionRequest
    | ImageDescriptionRequest
    | VideoDescriptionRequest
    | undefined;
  /** Optional global timeout signal (e.g. from agent-level cancellation). */
  signal?: AbortSignal;
}

const KIND_BY_CAPABILITY: Record<MediaCapability, MediaUnderstandingKind> = {
  audio: 'audio.transcription',
  image: 'image.description',
  video: 'video.description',
};

function orderProviders(
  providers: MediaUnderstandingProvider[],
  capability: MediaCapability,
  override?: readonly string[],
): MediaUnderstandingProvider[] {
  if (override && override.length > 0) {
    const lookup = new Map(providers.map((p) => [p.id.toLowerCase(), p]));
    const ordered: MediaUnderstandingProvider[] = [];
    const used = new Set<string>();
    for (const id of override) {
      const provider = lookup.get(id.toLowerCase());
      if (provider && !used.has(provider.id)) {
        ordered.push(provider);
        used.add(provider.id);
      }
    }
    // Append any registered providers not in the override (preserves capability
    // availability when the override list is incomplete).
    for (const provider of providers) {
      if (!used.has(provider.id)) {
        ordered.push(provider);
      }
    }
    return ordered;
  }
  return [...providers].sort((a, b) => {
    const aPriority = a.autoPriority?.[capability] ?? Number.MAX_SAFE_INTEGER;
    const bPriority = b.autoPriority?.[capability] ?? Number.MAX_SAFE_INTEGER;
    return aPriority - bPriority;
  });
}

function pickMethod(
  provider: MediaUnderstandingProvider,
  capability: MediaCapability,
): ((req: never) => Promise<{ text: string; model?: string }>) | undefined {
  if (capability === 'audio') {
    return provider.transcribeAudio as (
      req: AudioTranscriptionRequest,
    ) => Promise<AudioTranscriptionResult>;
  }
  if (capability === 'image') {
    return provider.describeImage as (
      req: ImageDescriptionRequest,
    ) => Promise<ImageDescriptionResult>;
  }
  return provider.describeVideo as (
    req: VideoDescriptionRequest,
  ) => Promise<VideoDescriptionResult>;
}

export async function runCapability(
  options: RunCapabilityOptions,
): Promise<MediaUnderstandingResult> {
  const eligibleProviders = listProvidersForCapability(options.capability);

  // Capability outcome is 'disabled' when no registered provider implements it.
  if (eligibleProviders.length === 0) {
    log.debug(
      { capability: options.capability },
      `No providers registered for capability "${options.capability}"`,
    );
    return {
      decision: {
        capability: options.capability,
        outcome: 'disabled',
        attachments: options.attachments.map((a) => ({
          attachmentIndex: a.attachmentIndex,
          attempts: [],
        })),
      },
      outputs: [],
    };
  }

  if (options.attachments.length === 0) {
    return {
      decision: { capability: options.capability, outcome: 'no-attachment', attachments: [] },
      outputs: [],
    };
  }

  const providers = orderProviders(eligibleProviders, options.capability, options.providerOrder);
  const attachmentDecisions: MediaUnderstandingAttachmentDecision[] = [];
  const outputs: MediaUnderstandingOutput[] = [];

  for (const attachment of options.attachments) {
    options.signal?.throwIfAborted();

    const attempts: MediaUnderstandingModelDecision[] = [];
    let chosen: MediaUnderstandingModelDecision | undefined;

    for (const provider of providers) {
      const method = pickMethod(provider, options.capability);
      if (!method) {
        // Defensive: registry filter should already exclude these. Recorded as
        // skipped so callers can diagnose registry/method mismatches.
        attempts.push({
          provider: provider.id,
          type: 'provider',
          outcome: 'skipped',
          reason: `provider "${provider.id}" missing method for capability "${options.capability}"`,
        });
        continue;
      }
      const request = options.buildRequest({ provider, attachment });
      if (!request) {
        attempts.push({
          provider: provider.id,
          type: 'provider',
          outcome: 'skipped',
          reason: 'caller buildRequest returned undefined (likely missing config)',
        });
        continue;
      }
      try {
        // We narrow `method` by capability above; cast through `unknown` to keep
        // a single call site without per-capability ceremony.
        const callResult = await (method as (req: unknown) => Promise<{ text: string; model?: string }>)(
          request,
        );
        const text = callResult.text?.trim() ?? '';
        if (!text) {
          attempts.push({
            provider: provider.id,
            type: 'provider',
            outcome: 'failed',
            reason: 'empty transcription/description text',
            model: callResult.model,
          });
          continue;
        }
        chosen = {
          provider: provider.id,
          type: 'provider',
          outcome: 'success',
          model: callResult.model,
        };
        attempts.push(chosen);
        outputs.push({
          kind: KIND_BY_CAPABILITY[options.capability],
          attachmentIndex: attachment.attachmentIndex,
          text,
          provider: provider.id,
          model: callResult.model,
        });
        break;
      } catch (error) {
        const reason = error instanceof Error ? error.message : String(error);
        log.warn(
          {
            err: error,
            providerId: provider.id,
            capability: options.capability,
            attachmentIndex: attachment.attachmentIndex,
          },
          `Provider "${provider.id}" failed for ${options.capability}: ${reason}`,
        );
        attempts.push({
          provider: provider.id,
          type: 'provider',
          outcome: 'failed',
          reason,
        });
      }
    }

    attachmentDecisions.push({
      attachmentIndex: attachment.attachmentIndex,
      attempts,
      ...(chosen ? { chosen } : {}),
    });
  }

  const overallOutcome = attachmentDecisions.every((d) => d.chosen)
    ? 'success'
    : attachmentDecisions.some((d) => d.chosen)
      ? 'success' // partial success — at least one attachment succeeded
      : 'failed';

  return {
    decision: {
      capability: options.capability,
      outcome: overallOutcome,
      attachments: attachmentDecisions,
    },
    outputs,
  };
}
