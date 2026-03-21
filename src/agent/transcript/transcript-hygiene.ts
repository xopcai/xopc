/**
 * Session transcript hygiene before LLM calls and after persistence (OpenClaw-style pipeline).
 * See OpenClaw `sanitizeSessionHistory` ordering (subset: no image/async paths here).
 */

import type { AgentMessage } from '@mariozechner/pi-agent-core';
import type { Api, Model } from '@mariozechner/pi-ai';
import { createLogger } from '../../utils/logger.js';
import { resolveTranscriptPolicy, type TranscriptPolicy } from './transcript-policy.js';
import { dropThinkingBlocks } from './thinking.js';
import {
  sanitizeToolCallInputs,
  sanitizeToolUseResultPairing,
  stripToolResultDetails,
} from './session-transcript-repair.js';
import { sanitizeToolCallIdsForCloudCodeAssist, type ToolCallIdMode } from './tool-call-id.js';

const log = createLogger('transcript-hygiene');

export type TranscriptHygieneParams = {
  modelApi?: string | null;
  provider?: string | null;
  modelId?: string | null;
};

export function resolvePolicyForModel(model: Model<Api>): TranscriptPolicy {
  return resolveTranscriptPolicy({
    modelApi: model.api,
    provider: model.provider,
    modelId: model.id,
  });
}

/**
 * Apply provider-aware transcript fixes: thinking drop, tool input cleanup,
 * tool_use/tool_result pairing repair, strip non-LLM details, optional tool-call ID sanitize.
 */
export function applySessionTranscriptHygiene(
  messages: AgentMessage[],
  model: Model<Api>,
): AgentMessage[] {
  const policy = resolvePolicyForModel(model);
  return applySessionTranscriptHygieneWithPolicy(messages, policy);
}

export function applySessionTranscriptHygieneWithPolicy(
  messages: AgentMessage[],
  policy: TranscriptPolicy,
): AgentMessage[] {
  let out = messages;

  if (policy.dropThinkingBlocks) {
    out = dropThinkingBlocks(out);
  }

  out = sanitizeToolCallInputs(out);

  if (policy.repairToolUseResultPairing) {
    out = sanitizeToolUseResultPairing(out);
  }

  out = stripToolResultDetails(out);

  if (policy.sanitizeToolCallIds && policy.toolCallIdMode) {
    const mode: ToolCallIdMode = policy.toolCallIdMode;
    out = sanitizeToolCallIdsForCloudCodeAssist(out, mode);
  }

  return out;
}

export function tryApplySessionTranscriptHygiene(
  messages: AgentMessage[],
  model: Model<Api>,
): AgentMessage[] {
  try {
    return applySessionTranscriptHygiene(messages, model);
  } catch (err) {
    log.warn({ err }, 'Transcript hygiene failed; using unmodified messages');
    return messages;
  }
}
