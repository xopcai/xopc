import type { ReasoningLevel } from '@/features/chat/messages/messages.types';

export const DEFAULT_THINKING = 'medium';
export const DEFAULT_REASONING: ReasoningLevel = 'on';

export type DefaultSessionMeta = {
  name: string | null;
  model: string;
  thinkingLevel: string;
  reasoningLevel: ReasoningLevel;
  modelSupportsThinking: boolean;
  effectiveWorkspacePath: string;
  workspaceSource: 'execution_environment' | 'project' | 'session_override' | 'agent_default_root' | 'agent_workspace';
  userContextMode: 'enabled' | 'off' | 'temporary';
};

export function defaultSessionMeta(): DefaultSessionMeta {
  return {
    name: null,
    model: '',
    thinkingLevel: DEFAULT_THINKING,
    reasoningLevel: DEFAULT_REASONING,
    modelSupportsThinking: false,
    effectiveWorkspacePath: '',
    workspaceSource: 'agent_default_root',
    userContextMode: 'enabled',
  };
}
