import { Plus } from 'lucide-react';

import { Button } from '@/components/ui/button';
import { cn } from '@/lib/cn';
import type { GatewayAgentRow } from '@/features/settings/agents-admin-api';
import type { AgentsSettingsMessages } from '@/i18n/messages';

import { agentsSettingsInputClass } from './utils';

export function AgentsSettingsHeader(props: {
  a: AgentsSettingsMessages;
  data: { agents: GatewayAgentRow[] } | null;
  loading: boolean;
  selectedId: string | null;
  busy: boolean;
  onSelectedIdChange: (id: string) => void;
  onOpenAddAgent: () => void;
}) {
  const { a, data, loading, selectedId, busy, onSelectedIdChange, onOpenAddAgent } = props;

  return (
    <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between sm:gap-3">
      <div className="min-w-0">
        <h1 className="text-lg font-semibold text-fg">{a.title}</h1>
        <p className="mt-1 text-sm text-fg-muted">{a.subtitle}</p>
      </div>
      {data && !loading ? (
        <div className="flex flex-col gap-2 sm:flex-row sm:items-end sm:justify-end sm:gap-3">
          <div className="w-full max-w-[9rem] shrink-0 sm:w-[9rem]">
            <select
              className={cn(agentsSettingsInputClass(), 'w-full')}
              aria-label={a.agent}
              value={selectedId ?? ''}
              onChange={(e) => onSelectedIdChange(e.target.value)}
            >
              {data.agents.map((ag) => (
                <option key={ag.id} value={ag.id}>
                  {ag.name ? `${ag.name} (${ag.id})` : ag.id}
                  {ag.isDefault ? ` — ${a.defaultBadge}` : ''}
                </option>
              ))}
            </select>
          </div>
          <Button
            type="button"
            variant="secondary"
            className="shrink-0 gap-1.5 rounded-xl px-3 sm:self-end"
            aria-label={a.addAgentAria}
            disabled={busy}
            onClick={() => onOpenAddAgent()}
          >
            <Plus className="size-4 shrink-0" strokeWidth={2} aria-hidden />
            <span>{a.addAgent}</span>
          </Button>
        </div>
      ) : null}
    </div>
  );
}
