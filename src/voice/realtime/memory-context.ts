import type { AgentMessage } from '@earendil-works/pi-agent-core';
import type { Config } from '../../config/schema.js';
import { parseAgentSessionKey, parseSessionKey } from '../../routing/session-key.js';
import { getUserProfile, getUnderstanding } from '../../storage/sqlite/user-context-repository.js';
import { getSessionConfig } from '../../storage/sqlite/config-repository.js';
import { getSessionMetadata } from '../../storage/sqlite/session-repository.js';
import { stripRuntimeContextFromUserMessage } from '../../session/user-message-display.js';
import { remoteContextEligibleIds } from '../../storage/sqlite/remote-context-repository.js';
import { selectAutomaticContext, type AutomaticContextSelection } from '../../user-context/automatic-context.js';
import { onUserContextChange } from '../../user-context/changes.js';
import { getUserFocus } from '../../user-context/sources/repository.js';
import { allowsAutomaticDisclosure, focusRejectionReason, rejectionReason } from '../../user-context/selection-policy.js';
import { createLogger } from '../../utils/logger.js';

const log = createLogger('Voice:Memory');
const policyVersion = (config: Config) => JSON.stringify({ userContext: config.userContext, agents: config.agents });

export interface VoiceMemorySnapshot extends AutomaticContextSelection {
  isCurrent: () => boolean;
  subscribe: (invalidate: () => void) => () => void;
}

export function voiceMemoryEnabled(config: Config, sessionKey: string): boolean {
  const parsed = parseSessionKey(sessionKey);
  const rest = parseAgentSessionKey(sessionKey)?.rest;
  const parts = rest?.split(':') ?? [];
  const explicitlyPrivate = rest === 'main' || (parts.every(Boolean)
    && !['cron', 'subagent'].includes(parts[0] ?? '')
    && ((parts[0] === 'direct' && parts.length >= 2)
      || (parts[1] === 'direct' && parts.length >= 3)
      || (parts[2] === 'direct' && parts.length >= 4)));
  const user = config.userContext;
  if (!parsed || !explicitlyPrivate || parsed.peerKind !== 'direct' || !user.enabled || !user.understanding.enabled
    || user.memory.mode === 'off' || !user.memory.sources.includes('understanding')) return false;
  const mode = getSessionConfig(sessionKey)?.userContextMode;
  return mode === undefined || mode === 'enabled';
}

export function voiceMemoryQuery(history: AgentMessage[]): string {
  return history.filter((message) => message.role === 'user').slice(-2).map((message) => {
    const text = typeof message.content === 'string' ? message.content : message.content
      .filter((part) => part.type === 'text').map((part) => part.type === 'text' ? part.text : '').join('\n');
    return stripRuntimeContextFromUserMessage(text).slice(-300);
  }).join('\n').slice(-600);
}

export function buildVoiceMemoryContext(input: {
  getConfig: () => Config;
  sessionKey: string;
  workspaceId: string;
  projectId?: string;
  history: AgentMessage[];
  maxChars: number;
}): VoiceMemorySnapshot | undefined {
  const started = performance.now();
  try {
    if (!voiceMemoryEnabled(input.getConfig(), input.sessionKey) || input.maxChars < 128) return;
    const policy = policyVersion(input.getConfig());
    const workspace = getSessionConfig(input.sessionKey)?.workingDirectoryOverride;
    const sessionId = getSessionMetadata(input.sessionKey)?.sessionId;
    const selection = selectAutomaticContext({ ...input, query: voiceMemoryQuery(input.history), deadline: started + 150 });
    if (!selection.block) return;
    let invalid = false;
    const isCurrent = () => {
      try {
        if (invalid || !voiceMemoryEnabled(input.getConfig(), input.sessionKey)
          || policy !== policyVersion(input.getConfig())
          || workspace !== getSessionConfig(input.sessionKey)?.workingDirectoryOverride) return false;
        const session = getSessionMetadata(input.sessionKey);
        if (session?.sessionId !== sessionId || session?.projectId !== input.projectId) return false;
        const understandingIds = selection.references.filter((r) => r.kind === 'understanding').map((r) => r.id);
        const focusIds = selection.references.filter((r) => r.kind === 'focus').map((r) => r.id);
        const allowed = new Set([...remoteContextEligibleIds('understanding', understandingIds), ...remoteContextEligibleIds('focus', focusIds)]);
        return selection.references.every((ref) => {
          if (ref.kind === 'profile') return ref.version === JSON.stringify(getUserProfile());
          if (!allowed.has(ref.id)) return false;
          if (ref.kind === 'focus') {
            const item = getUserFocus(ref.id);
            return !!item && item.versionId === ref.version && allowsAutomaticDisclosure(item)
              && !focusRejectionReason(item, input, Date.now());
          }
          const item = getUnderstanding(ref.id);
          return !!item && item.status === 'active' && item.versionId === ref.version
            && allowsAutomaticDisclosure(item)
            && !rejectionReason(item, input, Date.now(), []);
        });
      } catch { return false; }
    };
    log.debug({ sessionKey: input.sessionKey, selectedCount: selection.references.length,
      contextChars: selection.block.length, durationMs: performance.now() - started }, 'Native voice memory selected');
    return { ...selection, isCurrent, subscribe: (invalidate) => onUserContextChange((change) => {
      if (change.kind === 'policy'
        || (change.kind === 'session' && change.id === input.sessionKey && !isCurrent())
        || selection.references.some((ref) => ref.kind === change.kind && ref.id === change.id)) {
        if (!isCurrent()) {
          invalid = true;
          invalidate();
        }
      }
    }) };
  } catch {
    log.warn({ sessionKey: input.sessionKey, durationMs: performance.now() - started }, 'Native voice memory unavailable; continuing with chat history');
    return;
  }
}
