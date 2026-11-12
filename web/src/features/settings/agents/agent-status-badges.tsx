import { isPersonalAgentId } from '@/features/settings/agents/agent-display-names';
import type { AgentsSettingsMessages } from '@/i18n/messages';

export function AgentStatusBadges({
  agent,
  tuiDefaultAgentId,
  messages,
  showCustom = true,
  className = '',
}: {
  agent: { id: string; isDefault: boolean };
  tuiDefaultAgentId?: string;
  messages: AgentsSettingsMessages;
  showCustom?: boolean;
  className?: string;
}) {
  const isPersonal = isPersonalAgentId(agent.id);
  const isTuiDefault = agent.id === tuiDefaultAgentId;
  const isCustom = !agent.isDefault && !isTuiDefault && !isPersonal;
  if (isCustom && !showCustom) return null;

  return (
    <div className={`flex flex-wrap gap-1 ${className}`}>
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
      {isCustom ? (
        <span className="rounded-full bg-surface-hover px-2 py-0.5 text-[11px] font-medium text-fg-muted">
          {messages.listCustomBadge}
        </span>
      ) : null}
    </div>
  );
}
