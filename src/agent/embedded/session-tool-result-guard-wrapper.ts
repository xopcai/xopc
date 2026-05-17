import type { SessionManager } from '@earendil-works/pi-coding-agent';

import type { Config } from '../../config/schema.js';
import { installSessionToolResultGuard } from './session-tool-result-guard.js';
import { resolveLiveToolResultMaxChars } from './tool-result-truncation.js';

export type GuardedPiTranscriptManager = SessionManager & {
  flushPendingToolResults?: () => void;
  clearPendingToolResults?: () => void;
};

export function guardSessionManager(
  sessionManager: SessionManager,
  opts?: {
    agentId?: string;
    sessionKey?: string;
    config?: Config;
    contextWindowTokens?: number;
    allowSyntheticToolResults?: boolean;
    missingToolResultText?: string;
    allowedToolNames?: Iterable<string>;
  },
): GuardedPiTranscriptManager {
  if (typeof (sessionManager as GuardedPiTranscriptManager).flushPendingToolResults === 'function') {
    return sessionManager as GuardedPiTranscriptManager;
  }

  const guard = installSessionToolResultGuard(sessionManager, {
    sessionKey: opts?.sessionKey,
    allowSyntheticToolResults: opts?.allowSyntheticToolResults,
    missingToolResultText: opts?.missingToolResultText,
    allowedToolNames: opts?.allowedToolNames,
    maxToolResultChars:
      typeof opts?.contextWindowTokens === 'number'
        ? resolveLiveToolResultMaxChars({
            contextWindowTokens: opts.contextWindowTokens,
            cfg: opts?.config,
            agentId: opts?.agentId,
          })
        : undefined,
  });
  (sessionManager as GuardedPiTranscriptManager).flushPendingToolResults =
    guard.flushPendingToolResults;
  (sessionManager as GuardedPiTranscriptManager).clearPendingToolResults =
    guard.clearPendingToolResults;
  return sessionManager as GuardedPiTranscriptManager;
}
