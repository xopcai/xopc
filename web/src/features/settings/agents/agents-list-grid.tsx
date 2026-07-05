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
  defaultAgentId: string;
  tuiDefaultAgentId: string;
  tuiDefaultInherited: boolean;
  searchQuery: string;
  onOpenAgent: (id: string) => void;
  onChatWithAgent: (id: string) => void;
  busy: boolean;
}) {
  const {
    a,
    agents,
    defaultAgentId,
    tuiDefaultAgentId,
    tuiDefaultInherited,
    searchQuery,
    onOpenAgent,
    onChatWithAgent,
    busy,
  } = props;
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
          const capabilityMeta = agentCapabilityMeta(ag, a);
          const capabilityLabels = agentCapabilityLabels(ag, a);
          const isGlobalDefault = ag.id === defaultAgentId || ag.isDefault;
          const isTuiDefault = ag.id === tuiDefaultAgentId;
          const showInheritedTuiBadge = isTuiDefault && tuiDefaultInherited;
          const showExplicitTuiBadge = isTuiDefault && !tuiDefaultInherited;
          const openAgent = () => {
            if (busy) return;
            onOpenAgent(ag.id);
          };
          return (
            <li key={ag.id} className="h-full min-h-0">
              <article
                role="button"
                tabIndex={busy ? -1 : 0}
                aria-disabled={busy}
                aria-label={`${title} ${monoId}`}
                onClick={openAgent}
                onKeyDown={(event) => {
                  if (busy) return;
                  if (event.key !== 'Enter' && event.key !== ' ') return;
                  event.preventDefault();
                  onOpenAgent(ag.id);
                }}
                className={cn(
                  'flex min-h-[15.5rem] cursor-pointer flex-col rounded-xl border border-edge-subtle bg-surface-panel p-4 shadow-surface',
                  'transition-[border-color,transform,box-shadow] duration-150 ease-out',
                  'hover:border-edge-strong',
                  'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent focus-visible:ring-offset-2 focus-visible:ring-offset-surface-base',
                  'aria-disabled:pointer-events-none aria-disabled:cursor-not-allowed aria-disabled:opacity-60',
                  interaction.pressCard,
                )}
              >
                <div className="flex items-start justify-between gap-4">
                  <div className="flex min-w-0 items-start gap-3 text-left">
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
                  </div>
                  <div className="flex max-w-[9rem] shrink-0 flex-wrap justify-end gap-1.5">
                    {isGlobalDefault ? (
                      <span className="rounded-full bg-accent-soft px-2 py-0.5 text-xs font-medium text-accent">
                        {a.globalDefaultBadge}
                      </span>
                    ) : null}
                    {showExplicitTuiBadge ? (
                      <span className="rounded-full bg-surface-hover px-2 py-0.5 text-xs font-medium text-fg">
                        {a.tuiDefaultBadge}
                      </span>
                    ) : null}
                    {showInheritedTuiBadge ? (
                      <span className="rounded-full bg-surface-hover px-2 py-0.5 text-xs font-medium text-fg">
                        {a.tuiDefaultInheritedBadge}
                      </span>
                    ) : null}
                    {!isGlobalDefault && !isTuiDefault ? (
                      <span className="rounded-full bg-surface-hover px-2 py-0.5 text-xs font-medium text-fg-muted">
                        {a.listCustomBadge}
                      </span>
                    ) : null}
                  </div>
                </div>

                <div className="mt-5 min-h-[6.25rem] text-left">
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
                </div>

                <div className="mt-auto pt-4">
                  <Button
                    type="button"
                    variant="secondary"
                    disabled={busy}
                    onClick={(event) => {
                      event.stopPropagation();
                      onChatWithAgent(ag.id);
                    }}
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
