import type { AgentDefaultsState } from '@/features/settings/config-api';
import type { MessageBundle } from '@/i18n/messages';

export type AgentDefaultsPanelProps = {
  a: MessageBundle['agentSettings'];
  chat: MessageBundle['chat'];
  form: AgentDefaultsState;
  update: (patch: Partial<AgentDefaultsState>) => void;
};
