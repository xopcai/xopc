import { MessageSquarePlus } from 'lucide-react';

import type { GatewayAgentRow } from '@/features/settings/agents-admin-api';
import { AgentAvatarDisplay } from '@/features/settings/agents/agent-avatar-display';
import {
  agentListDisplayDescription,
  agentListDisplayName,
} from '@/features/settings/agents/agent-display-names';
import { collectLocalizedSearchText } from '@/features/settings/agents/localized-text';
import { cn } from '@/lib/cn';
import { interaction } from '@/lib/interaction';
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
    const localizedTexts = [
      ...collectLocalizedSearchText(ag.localized?.name),
      ...collectLocalizedSearchText(ag.localized?.description),
      ag.description ?? '',
    ].map((text) => text.toLowerCase());
    return (
      name.includes(q) ||
      id.includes(q) ||
      ws.includes(q) ||
      displayDesc.includes(q) ||
      localizedTexts.some((text) => text.includes(q))
    );
  });
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
          return (
            <li key={ag.id} className="h-full min-h-0">
              <div
                className={cn(
                  'flex h-full min-h-0 flex-col gap-3 rounded-xl border border-edge-subtle bg-surface-panel p-4 shadow-sm transition-colors',
                  'hover:border-edge',
                )}
              >
                <button
                  type="button"
                  disabled={busy}
                  onClick={() => onOpenAgent(ag.id)}
                  className={cn(
                    'flex shrink-0 w-full flex-col gap-2 text-left transition-colors',
                    'rounded-lg focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/40',
                    'disabled:pointer-events-none disabled:opacity-50',
                    interaction.pressCard,
                  )}
                >
                  <div className="flex items-start gap-3">
                    <div
                      className="flex size-11 shrink-0 items-center justify-center overflow-hidden rounded-xl bg-accent-soft ring-1 ring-edge-subtle/40"
                      aria-hidden
                    >
                      <AgentAvatarDisplay agentId={ag.id} avatar={ag.avatar} size={44} className="size-full" />
                    </div>
                    <div className="min-w-0 flex-1">
                      <div className="flex flex-wrap items-center gap-x-2 gap-y-0.5">
                        <span className="truncate font-semibold text-fg">{title}</span>
                        {ag.isDefault ? (
                          <span className="shrink-0 rounded-md bg-surface-base px-1.5 py-0.5 text-[10px] font-medium uppercase tracking-wide text-fg-muted">
                            {a.defaultBadge}
                          </span>
                        ) : null}
                      </div>
                      <p className="mt-0.5 truncate font-mono text-xs text-fg-muted" title={monoId}>
                        {monoId}
                      </p>
                    </div>
                  </div>
                  <p
                    className={cn(
                      'line-clamp-1 min-h-5.25 text-xs leading-relaxed',
                      descTrim ? 'text-fg' : 'text-fg-muted/25',
                    )}
                    title={descTrim || undefined}
                  >
                    {descTrim || '\u00A0'}
                  </p>
                </button>
                <div className="flex shrink-0 items-center gap-2">
                  <button
                    type="button"
                    disabled={busy}
                    onClick={() => onChatWithAgent(ag.id)}
                    className={cn(
                      'flex flex-1 items-center justify-center gap-2 rounded-full px-4 py-2.5 text-sm font-semibold',
                      'bg-accent-soft text-accent-fg transition-colors',
                      'hover:bg-accent/15',
                      'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/40',
                      'disabled:pointer-events-none disabled:opacity-50',
                      interaction.press,
                    )}
                  >
                    <MessageSquarePlus className="size-4 shrink-0" strokeWidth={2} aria-hidden />
                    {a.listChatWithAgent}
                  </button>
                </div>
              </div>
            </li>
          );
        })}
      </ul>
    </div>
  );
}
