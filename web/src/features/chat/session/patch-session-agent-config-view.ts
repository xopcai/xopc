import { coerceReasoningLevel } from '@/features/chat/messages/messages.types';
import { DEFAULT_THINKING } from '@/features/chat/session/chat-session-defaults';
import { useChatSessionStore } from '@/features/chat/session/chat-session-store';

export type SessionAgentConfigView = {
  model: string;
  thinkingLevel?: string | null;
  reasoningLevel?: string | null;
  activityDetail?: {
    default: string;
    override: string | null;
    effective: string;
    source: 'session' | 'default';
  };
  effectiveWorkspacePath?: string | null;
  workingDirectoryLocked?: boolean;
  workspaceSource?: 'project' | 'session_override' | 'agent_default_root' | 'agent_workspace';
};

/** Apply resolved session agent settings to the chat session store slice. */
export function patchSessionAgentConfigView(sessionKey: string, cfg: SessionAgentConfigView): void {
  const key = String(sessionKey ?? '').trim();
  if (!key) return;
  const activityDetailDefault = coerceReasoningLevel(cfg.activityDetail?.default);
  const activityDetailOverride = cfg.activityDetail?.override == null
    ? null
    : coerceReasoningLevel(cfg.activityDetail.override);
  useChatSessionStore.getState().patchSessionMeta(key, {
    model: cfg.model,
    thinkingLevel: cfg.thinkingLevel || DEFAULT_THINKING,
    reasoningLevel: coerceReasoningLevel(
      cfg.activityDetail?.effective ?? cfg.reasoningLevel ?? undefined,
    ),
    activityDetailDefault,
    activityDetailOverride,
    effectiveWorkspacePath: cfg.effectiveWorkspacePath ?? '',
    workingDirectoryLocked: Boolean(cfg.workingDirectoryLocked),
    workspaceSource: cfg.workspaceSource ?? 'agent_default_root',
  });
}
