import { ExternalRuntimePill } from '@/components/brand/external-runtime-badge';
import { isPersonalAgentId } from '@/features/settings/agents/agent-display-names';
import type { ExternalAgentExecution } from '@/features/settings/types/agent-gateway';
import type { AgentsSettingsMessages } from '@/i18n/messages';

export function AgentStatusBadges({
  agent,
  tuiDefaultAgentId,
  messages,
  showCustom = true,
  className = '',
}: {
  agent: { id: string; isDefault: boolean; override?: { execution?: ExternalAgentExecution } };
  tuiDefaultAgentId?: string;
  messages: AgentsSettingsMessages;
  showCustom?: boolean;
  className?: string;
}) {
  const isPersonal = isPersonalAgentId(agent.id);
  const isTuiDefault = agent.id === tuiDefaultAgentId;
  const executionKind = agent.override?.execution?.kind;
  const isCustom = !agent.isDefault && !isTuiDefault && !isPersonal && !executionKind;
  if (isCustom && !showCustom) return null;

  return (
    <div className={`flex flex-wrap gap-1 ${className}`}>
      {executionKind ? (
        <ExternalRuntimePill kind={executionKind} variant="full" tone="accent" />
      ) : null}
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
