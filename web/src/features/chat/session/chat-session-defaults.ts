import type { ReasoningLevel } from '@/features/chat/messages/messages.types';

export const DEFAULT_THINKING = 'medium';
export const DEFAULT_REASONING: ReasoningLevel = 'on';

export type DefaultSessionMeta = {
  name: string | null;
  model: string;
  thinkingLevel: string;
  reasoningLevel: ReasoningLevel;
  activityDetailDefault: ReasoningLevel;
  activityDetailOverride: ReasoningLevel | null;
  modelSupportsThinking: boolean;
  effectiveWorkspacePath: string;
  workingDirectoryLocked: boolean;
  workspaceSource: 'project' | 'session_override' | 'agent_default_root' | 'agent_workspace';
};

export function defaultSessionMeta(): DefaultSessionMeta {
  return {
    name: null,
    model: '',
    thinkingLevel: DEFAULT_THINKING,
    reasoningLevel: DEFAULT_REASONING,
    activityDetailDefault: DEFAULT_REASONING,
    activityDetailOverride: null,
    modelSupportsThinking: false,
    effectiveWorkspacePath: '',
    workingDirectoryLocked: false,
    workspaceSource: 'agent_default_root',
  };
}

export const WEBCHAT_AGENT_STORAGE_KEY = 'xopc.webchat.agentId';

export function readStoredWebchatAgentId(): string | null {
  if (typeof globalThis.localStorage === 'undefined') return null;
  try {
    const v = globalThis.localStorage.getItem(WEBCHAT_AGENT_STORAGE_KEY)?.trim().toLowerCase();
    return v || null;
  } catch {
    return null;
  }
}
