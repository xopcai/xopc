import * as Tooltip from '@radix-ui/react-tooltip';
import { MessageSquarePlus } from 'lucide-react';

import { Button } from '@/components/ui/button';
import type { GatewayAgentRow } from '@/features/settings/agents-admin-api';
import { AgentAvatarDisplay } from '@/features/settings/agents/agent-avatar-display';
import {
  agentListDisplayDescription,
  agentListDisplayName,
} from '@/features/settings/agents/agent-display-names';
import { cn } from '@/lib/cn';
import { interaction } from '@/lib/interaction';
import { SETTINGS_SHELL_POPOVER_Z } from '@/lib/settings-shell-dialog-layer';
import type { AgentsSettingsMessages } from '@/i18n/messages';

function filterAgents(agents: GatewayAgentRow[], query: string, a: AgentsSettingsMessages): GatewayAgentRow[] {
  const q = query.trim().toLowerCase();
  if (!q) {
    return agents;
  }
  return agents.filter((ag) => {
    const name = agentListDisplayName(ag, a).toLowerCase();
    const id = ag.id.toLowerCase();
    const ws = ag.workspace.toLowerCase();
    const displayDesc = agentListDisplayDescription(ag, a).toLowerCase();
    return (
      name.includes(q) ||
      id.includes(q) ||
      ws.includes(q) ||
      displayDesc.includes(q)
    );
  });
}

function formatCount(template: string, count: number): string {
  return template.replace('{{count}}', String(count));
}

function agentPrimaryFacts(ag: GatewayAgentRow, a: AgentsSettingsMessages): Array<{
  label: string;
  value: string;
  title?: string;
}> {
  const model = ag.model?.primary?.trim();
  const workspace = ag.workspace.trim();

  return [
    {
      label: a.listModelLabel,
      value: model || a.listInheritedValue,
      title: model || undefined,
    },
    {
      label: a.listWorkspaceLabel,
      value: workspace || a.listUnsetValue,
      title: workspace || undefined,
    },
  ];
}

function agentCapabilityMeta(ag: GatewayAgentRow, a: AgentsSettingsMessages): string {
  const disabledTools = ag.tools.effectiveDisable.length;
  const skillCount = ag.skills.effectiveAllowlist?.length ?? 0;
  const toolsText = disabledTools > 0
    ? formatCount(a.listToolsDisabledCount, disabledTools)
    : a.listToolsAllEnabled;
  const skillsText = skillCount > 0
    ? formatCount(a.listSkillsCount, skillCount)
    : a.listInheritedValue;

  return `${a.listToolsLabel} ${toolsText} · ${a.listSkillsLabel} ${skillsText}`;
}

function agentCapabilityLabels(ag: GatewayAgentRow, a: AgentsSettingsMessages): string[] {
  const disabledTools = ag.tools.effectiveDisable.length;
  const skillCount = ag.skills.effectiveAllowlist?.length ?? 0;
  const toolsText = disabledTools > 0
    ? formatCount(a.listToolsDisabledCount, disabledTools)
    : a.listToolsAllEnabled;
  const skillsText = skillCount > 0
    ? formatCount(a.listSkillsCount, skillCount)
    : a.listInheritedValue;
  return [`${a.listToolsLabel} ${toolsText}`, `${a.listSkillsLabel} ${skillsText}`];
}

function TextTooltip({
  text,
  children,
  className,
}: {
  text: string;
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <Tooltip.Provider delayDuration={300} skipDelayDuration={100}>
      <Tooltip.Root>
        <Tooltip.Trigger asChild>
          <span className={className} title={text}>
            {children}
          </span>
        </Tooltip.Trigger>
        <Tooltip.Portal>
          <Tooltip.Content
            side="top"
            align="start"
            sideOffset={6}
            className={cn(
              'max-w-[min(28rem,calc(100vw-2rem))] rounded-lg border border-edge bg-surface-panel px-2.5 py-2',
              'text-left text-xs leading-snug text-fg shadow-popover',
              SETTINGS_SHELL_POPOVER_Z,
            )}
          >
            {text}
            <Tooltip.Arrow className="fill-surface-panel" />
          </Tooltip.Content>
        </Tooltip.Portal>
      </Tooltip.Root>
    </Tooltip.Provider>
  );
}

export function AgentsListGrid(props: {
  a: AgentsSettingsMessages;
  agents: GatewayAgentRow[];
  searchQuery: string;
  onOpenAgent: (id: string) => void;
  onChatWithAgent: (id: string) => void;
  busy: boolean;
}) {
  const { a, agents, searchQuery, onOpenAgent, onChatWithAgent, busy } = props;
  const filtered = filterAgents(agents, searchQuery, a);
  const searchMiss = agents.length > 0 && filtered.length === 0 && searchQuery.trim().length > 0;

  if (agents.length === 0) {
    return <p className="text-sm text-fg-muted">{a.listNoAgentsYet}</p>;
  }

  return (
    <div className="flex flex-col gap-4">
      {searchMiss ? <p className="text-sm text-fg-muted">{a.listEmpty}</p> : null}

      <ul className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
        {filtered.map((ag) => {
          const title = agentListDisplayName(ag, a);
          const monoId = ag.id;
          const descTrim = agentListDisplayDescription(ag, a);
          const facts = agentPrimaryFacts(ag, a);
          const capabilityMeta = agentCapabilityMeta(ag, a);
          const capabilityLabels = agentCapabilityLabels(ag, a);
          return (
            <li key={ag.id} className="h-full min-h-0">
              <article className="flex min-h-[15.5rem] flex-col rounded-xl border border-edge-subtle bg-surface-panel p-4 shadow-surface transition-colors hover:border-edge">
                <div className="flex items-start justify-between gap-4">
                  <button
                    type="button"
                    disabled={busy}
                    onClick={() => onOpenAgent(ag.id)}
                    className={cn(
                      'flex min-w-0 items-start gap-3 text-left',
                      'rounded-lg focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/40',
                      'disabled:pointer-events-none disabled:opacity-50',
                      interaction.pressCard,
                    )}
                  >
                    <div
                      className="flex size-12 shrink-0 items-center justify-center overflow-hidden rounded-2xl bg-surface-base text-fg ring-1 ring-edge-subtle/40"
                      aria-hidden
                    >
                      <AgentAvatarDisplay agentId={ag.id} avatar={ag.avatar} size={48} className="size-full" />
                    </div>
                    <div className="min-w-0">
                      <h2 className="truncate text-base font-semibold text-fg">{title}</h2>
                      <p className="mt-1 truncate font-mono text-xs text-fg-muted" title={monoId}>
                        {monoId}
                      </p>
                    </div>
                  </button>
                  {ag.isDefault ? (
                    <span className="shrink-0 rounded-full bg-accent-soft px-2 py-0.5 text-xs font-medium text-accent">
                      {a.defaultBadge}
                    </span>
                  ) : (
                    <span className="shrink-0 rounded-full bg-surface-hover px-2 py-0.5 text-xs font-medium text-fg-muted">
                      {a.listCustomBadge}
                    </span>
                  )}
                </div>

                <button
                  type="button"
                  disabled={busy}
                  onClick={() => onOpenAgent(ag.id)}
                  className={cn(
                    'mt-5 min-h-[6.25rem] text-left',
                    'rounded-lg focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/40',
                    'disabled:pointer-events-none disabled:opacity-50',
                  )}
                >
                  <div className="rounded-lg border border-edge-subtle bg-surface-base px-3 py-3">
                    <p
                      className={cn(
                        'line-clamp-2 text-sm leading-5',
                        descTrim ? 'text-fg' : 'text-fg-muted',
                      )}
                      title={descTrim || undefined}
                    >
                      {descTrim || a.listNoDescription}
                    </p>
                    <div className="mt-3 space-y-1 text-sm leading-5 text-fg-muted">
                      {facts.map((item) => (
                        <p key={item.label} className="flex min-w-0 items-baseline gap-2">
                          <span className="shrink-0 text-xs font-medium text-fg-subtle">{item.label}</span>
                          <TextTooltip text={item.title ?? item.value} className="min-w-0 truncate">
                            {item.value}
                          </TextTooltip>
                        </p>
                      ))}
                    </div>
                  </div>
                  <div className="mt-3 flex flex-wrap gap-1.5" title={capabilityMeta}>
                    {capabilityLabels.map((label) => (
                      <TextTooltip
                        key={label}
                        text={label}
                        className="rounded-full bg-surface-hover px-2 py-0.5 text-xs text-fg-muted"
                      >
                        {label}
                      </TextTooltip>
                    ))}
                  </div>
                </button>

                <div className="mt-auto pt-4">
                  <Button
                    type="button"
                    variant="primary"
                    disabled={busy}
                    onClick={() => onChatWithAgent(ag.id)}
                    className="w-full rounded-2xl py-2.5"
                  >
                    <MessageSquarePlus className="size-4 shrink-0" strokeWidth={2} aria-hidden />
                    {a.listChatWithAgent}
                  </Button>
                </div>
              </article>
            </li>
          );
        })}
      </ul>
    </div>
  );
}
