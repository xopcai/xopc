import { Plus } from 'lucide-react';

import { Button } from '@/components/ui/button';
import type { GatewayAgentRow } from '@/features/settings/agents-admin-api';
import type { AgentsSettingsMessages } from '@/i18n/messages';

export function AgentsSettingsHeader(props: {
  a: AgentsSettingsMessages;
  data: { agents: GatewayAgentRow[] } | null;
  loading: boolean;
  busy: boolean;
  onOpenAddAgent: () => void;
}) {
  const { a, data, loading, busy, onOpenAddAgent } = props;

  return (
    <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between sm:gap-3">
      <div className="min-w-0">
        <h1 className="text-lg font-semibold text-fg">{a.title}</h1>
        <p className="mt-1 text-sm text-fg-muted">{a.subtitle}</p>
      </div>
      {data && !loading ? (
        <div className="flex flex-col gap-2 sm:flex-row sm:items-end sm:justify-end">
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
