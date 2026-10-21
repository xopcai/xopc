import { Plus } from 'lucide-react';

import { Button } from '@/components/ui/button';
import type { messages } from '@/i18n/messages';

import type { McpLastCheck, McpServerRow } from '../mcp/mcp-config-api';
import { CustomMcpServerCard } from './custom-mcp-server-card';

export function CustomMcpServersSection({ servers, lastChecks, t, cs, onAdd, onEdit, onRemove }: {
  servers: McpServerRow[];
  lastChecks: Record<string, McpLastCheck>;
  t: ReturnType<typeof messages>['mcpSettings'];
  cs: ReturnType<typeof messages>['connectorsSettings'];
  onAdd: () => void;
  onEdit: (row: McpServerRow) => void;
  onRemove: (row: McpServerRow) => Promise<void>;
}) {
  return (
    <section aria-label={cs.customIntegrationsTitle}>
      <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
        <div className="min-w-0">
          <div className="flex items-center gap-2">
            <h2 className="text-sm font-semibold text-fg">{cs.customIntegrationsTitle}</h2>
            <span className="rounded-md bg-surface-inset px-1.5 py-0.5 text-xs tabular-nums text-fg-muted">{servers.length}</span>
          </div>
          <p className="mt-1 text-xs text-fg-muted">{cs.customIntegrationsHint}</p>
        </div>
        <Button variant="secondary" className="shrink-0 text-xs shadow-none sm:shadow-none" onClick={onAdd}>
          <Plus className="size-3.5" aria-hidden />
          {cs.customAdd}
        </Button>
      </div>
      {servers.length ? (
        <ul className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
          {servers.map(row => <CustomMcpServerCard key={row.clientKey} row={row} lastCheck={lastChecks[row.id]} t={t} cs={cs} onEdit={() => onEdit(row)} onRemove={() => onRemove(row)} />)}
        </ul>
      ) : <p className="rounded-xl border border-dashed border-edge px-5 py-8 text-center text-sm text-fg-muted">{cs.customEmpty}</p>}
    </section>
  );
}
