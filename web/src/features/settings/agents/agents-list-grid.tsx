import { MessageSquarePlus, Plus } from 'lucide-react';

import type { GatewayAgentRow } from '@/features/settings/agents-admin-api';
import { AgentAvatarDisplay } from '@/features/settings/agents/agent-avatar-display';
import { cn } from '@/lib/cn';
import type { AgentsSettingsMessages } from '@/i18n/messages';

function filterAgents(agents: GatewayAgentRow[], query: string): GatewayAgentRow[] {
  const q = query.trim().toLowerCase();
  if (!q) {
    return agents;
  }
  return agents.filter((ag) => {
    const name = (ag.name ?? '').toLowerCase();
    const id = ag.id.toLowerCase();
    const ws = ag.workspace.toLowerCase();
    const desc = (ag.description ?? '').toLowerCase();
    return name.includes(q) || id.includes(q) || ws.includes(q) || desc.includes(q);
  });
}

function NewAgentCard(props: {
  a: AgentsSettingsMessages;
  busy: boolean;
  onNewAgent: () => void;
}) {
  const { a, busy, onNewAgent } = props;
  return (
    <button
      type="button"
      disabled={busy}
      onClick={() => onNewAgent()}
      className={cn(
        'flex h-full min-h-[7.5rem] w-full flex-col items-center justify-center gap-2 rounded-xl border-2 border-dashed border-edge-subtle bg-surface-panel/40 px-4 py-6 text-sm font-medium text-fg-muted transition-colors',
        'hover:border-accent/50 hover:bg-surface-hover hover:text-fg',
        'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/40',
        'disabled:pointer-events-none disabled:opacity-50',
      )}
    >
      <Plus className="size-8 shrink-0 opacity-80" strokeWidth={1.75} aria-hidden />
      <span>{a.listNewAgentCard}</span>
    </button>
  );
}

export function AgentsListGrid(props: {
  a: AgentsSettingsMessages;
  agents: GatewayAgentRow[];
  searchQuery: string;
  onOpenAgent: (id: string) => void;
  onChatWithAgent: (id: string) => void;
  onNewAgent: () => void;
  busy: boolean;
}) {
  const { a, agents, searchQuery, onOpenAgent, onChatWithAgent, onNewAgent, busy } = props;
  const filtered = filterAgents(agents, searchQuery);
  const searchMiss = agents.length > 0 && filtered.length === 0 && searchQuery.trim().length > 0;

  if (agents.length === 0) {
    return (
      <div className="flex flex-col gap-4">
        <p className="text-sm text-fg-muted">{a.listNoAgentsYet}</p>
        <div className="max-w-sm">
          <NewAgentCard a={a} busy={busy} onNewAgent={onNewAgent} />
        </div>
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-4">
      {searchMiss ? <p className="text-sm text-fg-muted">{a.listEmpty}</p> : null}

      <ul
        className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3"
        role="list"
      >
        <li className="h-full min-h-0">
          <NewAgentCard a={a} busy={busy} onNewAgent={onNewAgent} />
        </li>
        {filtered.map((ag) => {
          const title = ag.name?.trim() ? ag.name.trim() : ag.id;
          const monoId = ag.id;
          const descTrim = ag.description?.trim() ?? '';
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
                      'line-clamp-1 min-h-[1.3125rem] text-xs leading-relaxed',
                      descTrim ? 'text-fg' : 'text-fg-muted/25',
                    )}
                    title={descTrim || undefined}
                  >
                    {descTrim || '\u00A0'}
                  </p>
                </button>
                <button
                  type="button"
                  disabled={busy}
                  onClick={() => onChatWithAgent(ag.id)}
                  className={cn(
                    'flex w-full shrink-0 items-center justify-center gap-2 rounded-full px-4 py-2.5 text-sm font-semibold',
                    'bg-accent-soft text-accent-fg transition-colors',
                    'hover:bg-accent/15',
                    'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/40',
                    'disabled:pointer-events-none disabled:opacity-50',
                  )}
                >
                  <MessageSquarePlus className="size-4 shrink-0" strokeWidth={2} aria-hidden />
                  {a.listChatWithAgent}
                </button>
              </div>
            </li>
          );
        })}
      </ul>
    </div>
  );
}
