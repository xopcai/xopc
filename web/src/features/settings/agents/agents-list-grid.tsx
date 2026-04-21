import { Bot, Plus } from 'lucide-react';

import type { GatewayAgentRow } from '@/features/settings/agents-admin-api';
import { cn } from '@/lib/cn';
import type { AgentsSettingsMessages } from '@/i18n/messages';

import { agentsSettingsInputClass } from './utils';

function filterAgents(agents: GatewayAgentRow[], query: string): GatewayAgentRow[] {
  const q = query.trim().toLowerCase();
  if (!q) {
    return agents;
  }
  return agents.filter((ag) => {
    const name = (ag.name ?? '').toLowerCase();
    const id = ag.id.toLowerCase();
    const ws = ag.workspace.toLowerCase();
    return name.includes(q) || id.includes(q) || ws.includes(q);
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
  onSearchQueryChange: (q: string) => void;
  onOpenAgent: (id: string) => void;
  onNewAgent: () => void;
  busy: boolean;
}) {
  const { a, agents, searchQuery, onSearchQueryChange, onOpenAgent, onNewAgent, busy } = props;
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
      <label className="flex flex-col gap-1.5 text-sm sm:max-w-md">
        <span className="text-fg-muted">{a.listSearchPlaceholder}</span>
        <input
          type="search"
          className={agentsSettingsInputClass()}
          value={searchQuery}
          onChange={(e) => onSearchQueryChange(e.target.value)}
          autoComplete="off"
          aria-label={a.listSearchPlaceholder}
        />
      </label>

      {searchMiss ? <p className="text-sm text-fg-muted">{a.listEmpty}</p> : null}

      <ul
        className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3"
        role="list"
      >
        <li>
          <NewAgentCard a={a} busy={busy} onNewAgent={onNewAgent} />
        </li>
        {filtered.map((ag) => {
          const title = ag.name?.trim() ? ag.name.trim() : ag.id;
          const monoId = ag.id;
          return (
            <li key={ag.id}>
              <button
                type="button"
                disabled={busy}
                onClick={() => onOpenAgent(ag.id)}
                className={cn(
                  'flex h-full w-full flex-col gap-2 rounded-xl border border-edge-subtle bg-surface-panel p-4 text-left shadow-sm transition-colors',
                  'hover:border-edge hover:bg-surface-hover',
                  'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/40',
                  'disabled:pointer-events-none disabled:opacity-50',
                )}
              >
                <div className="flex items-start gap-3">
                  <span
                    className="flex size-11 shrink-0 items-center justify-center rounded-xl bg-accent-soft text-accent-fg"
                    aria-hidden
                  >
                    <Bot className="size-6" strokeWidth={1.75} />
                  </span>
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
                <p className="line-clamp-2 text-xs leading-relaxed text-fg-muted" title={ag.workspace}>
                  {ag.workspace}
                </p>
                <div className="mt-auto pt-1">
                  <span className="text-xs font-medium text-accent-fg">{a.listOpenEditor}</span>
                </div>
              </button>
            </li>
          );
        })}
      </ul>
    </div>
  );
}
