import { isPersonalAgentId } from '@/features/settings/agents/agent-display-names';
import type { AgentsSettingsMessages } from '@/i18n/messages';

export function AgentStatusBadges({
  agent,
  tuiDefaultAgentId,
  messages,
}: {
  agent: { id: string; isDefault: boolean };
  tuiDefaultAgentId?: string;
  messages: AgentsSettingsMessages;
}) {
  const isPersonal = isPersonalAgentId(agent.id);
  const isTuiDefault = agent.id === tuiDefaultAgentId;

  return (
    <div className="flex shrink-0 flex-wrap justify-end gap-1">
      {agent.isDefault ? (
        <span className="rounded-full bg-accent-soft px-2 py-0.5 text-[11px] font-medium text-accent">
          {messages.listDefaultBadge}
        </span>
      ) : null}
      {isTuiDefault ? (
        <span className="rounded-full bg-surface-hover px-2 py-0.5 text-[11px] font-medium text-fg">
          {messages.tuiDefaultBadge}
        </span>
      ) : null}
      {isPersonal ? (
        <span className="rounded-full bg-surface-hover px-2 py-0.5 text-[11px] font-medium text-fg">
          {messages.listPersonalDefaultBadge}
        </span>
      ) : null}
      {!agent.isDefault && !isTuiDefault && !isPersonal ? (
        <span className="rounded-full bg-surface-hover px-2 py-0.5 text-[11px] font-medium text-fg-muted">
          {messages.listCustomBadge}
        </span>
      ) : null}
    </div>
  );
}
