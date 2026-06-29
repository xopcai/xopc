import { Loader2, Pencil, PlugZap, Trash2 } from 'lucide-react';
import { useCallback, useState } from 'react';

import { Button } from '@/components/ui/button';
import { messages } from '@/i18n/messages';

import { testMcpServer, type McpServerRow } from '../mcp/mcp-config-api';
import { mcpServerEndpointSummary } from '../mcp/mcp-server-endpoint-summary';

export function CustomMcpServerRow({
  row,
  t,
  cs,
  onEdit,
  onRemove,
}: {
  row: McpServerRow;
  t: ReturnType<typeof messages>['mcpSettings'];
  cs: ReturnType<typeof messages>['connectorsSettings'];
  onEdit: () => void;
  onRemove: () => Promise<void>;
}) {
  const [testing, setTesting] = useState(false);
  const [removing, setRemoving] = useState(false);
  const [capabilityCounts, setCapabilityCounts] = useState<{
    toolCount: number;
    resourceCount: number;
    promptCount: number;
  } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const summary = mcpServerEndpointSummary(row);

  const runTest = useCallback(async () => {
    setTesting(true);
    setError(null);
    try {
      const result = await testMcpServer(row.id.trim());
      setCapabilityCounts({
        toolCount: result.toolCount,
        resourceCount: result.resourceCount,
        promptCount: result.promptCount,
      });
    } catch (testError) {
      setError(testError instanceof Error ? testError.message : String(testError));
    } finally {
      setTesting(false);
    }
  }, [row.id]);

  const remove = useCallback(async () => {
    setRemoving(true);
    setError(null);
    try {
      await onRemove();
    } catch (removeError) {
      setError(removeError instanceof Error ? removeError.message : String(removeError));
      setRemoving(false);
    }
  }, [onRemove]);

  return (
    <div className="rounded-2xl border border-edge bg-surface-panel p-4 shadow-surface">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-2">
            <h3 className="text-sm font-semibold text-fg">{row.id.trim() || t.cardUntitled}</h3>
            <span className="rounded-full border border-edge bg-surface-base px-2 py-0.5 text-[11px] text-fg-muted">
              {cs.customBadge}
            </span>
            <span className="rounded-full bg-surface-hover px-2 py-0.5 text-[11px] font-medium text-fg-muted">
              {t.transportLabels[row.transport]}
            </span>
          </div>
          {summary ? (
            <p className="mt-1 truncate font-mono text-xs text-fg-subtle" title={summary}>
              {summary}
            </p>
          ) : null}
        </div>
        <div className="flex gap-2">
          <Button variant="secondary" disabled={testing} onClick={() => void runTest()}>
            {testing ? <Loader2 className="size-4 animate-spin" /> : <PlugZap className="size-4" />}
            {t.testConnection}
          </Button>
          <Button variant="secondary" onClick={onEdit}>
            <Pencil className="size-4" />
            {cs.editCustomServer}
          </Button>
          <Button variant="ghost" disabled={removing} onClick={() => void remove()}>
            {removing ? <Loader2 className="size-4 animate-spin" /> : <Trash2 className="size-4" />}
            {t.removeServer}
          </Button>
        </div>
      </div>
      {error ? <p className="mt-3 rounded-xl bg-red-500/10 px-3 py-2 text-sm text-red-600">{error}</p> : null}
      {capabilityCounts ? (
        <p className="mt-3 text-sm text-fg-muted">
          {capabilityCounts.toolCount} tools, {capabilityCounts.resourceCount} resources,{' '}
          {capabilityCounts.promptCount} prompts discovered.
        </p>
      ) : null}
    </div>
  );
}

