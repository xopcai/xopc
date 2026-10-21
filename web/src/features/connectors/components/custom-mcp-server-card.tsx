import * as DropdownMenu from '@radix-ui/react-dropdown-menu';
import { CheckCircle2, Clock3, MoreHorizontal, PauseCircle, Server, Terminal, Trash2 } from 'lucide-react';
import { useRef, useState } from 'react';

import { Button } from '@/components/ui/button';
import { ConfirmDialog } from '@/components/ui/confirm-dialog';
import type { messages } from '@/i18n/messages';
import { cn } from '@/lib/cn';
import { useLocaleStore } from '@/stores/locale-store';

import type { McpServerRow, McpLastCheck } from '../mcp/mcp-config-api';
import { McpToolsDialog } from '../mcp/mcp-tools-dialog';
import { mcpServerEndpointSummary } from '../mcp/mcp-server-endpoint-summary';

export function CustomMcpServerCard({ row, lastCheck, t, cs, onEdit, onRemove }: {
  row: McpServerRow;
  lastCheck?: McpLastCheck;
  t: ReturnType<typeof messages>['mcpSettings'];
  cs: ReturnType<typeof messages>['connectorsSettings'];
  onEdit: () => void;
  onRemove: () => Promise<void>;
}) {
  const language = useLocaleStore(s => s.language);
  const [showTools, setShowTools] = useState(false);
  const toolsTrigger = useRef<HTMLButtonElement>(null);
  const [confirm, setConfirm] = useState(false);
  const [error, setError] = useState('');
  const name = row.displayName || row.id;
  const endpoint = mcpServerEndpointSummary(row);
  const disabled = row.extra.enabled === false;
  const StatusIcon = disabled ? PauseCircle : lastCheck ? CheckCircle2 : Clock3;
  const TransportIcon = row.transport === 'stdio' ? Terminal : Server;
  const status = disabled ? t.setupDisabled : lastCheck ? cs.customCheckSucceeded : cs.customUnchecked;
  const checkedAt = lastCheck
    ? new Intl.DateTimeFormat(language, { dateStyle: 'medium', timeStyle: 'short' }).format(new Date(lastCheck.checkedAt))
    : null;

  return (
    <li className="flex min-h-[8.75rem] min-w-0 flex-col rounded-xl border border-edge bg-surface-panel p-4 transition-colors hover:bg-surface-hover/45 focus-within:ring-2 focus-within:ring-accent/30">
      <div className="flex min-w-0 flex-1 flex-col">
        <div className="flex min-w-0 items-start gap-3">
          <div title={t.transportLabels[row.transport]} className="flex size-9 shrink-0 items-center justify-center rounded-xl border border-edge-subtle bg-surface-inset text-fg-muted">
            <TransportIcon className="size-4" aria-hidden />
          </div>
          <div className="min-w-0 flex-1">
            <div className="flex min-w-0 flex-col items-start gap-1">
              <h3 className="min-w-0 max-w-full text-sm font-semibold text-fg">
                <button type="button" onClick={onEdit} title={name} className="block max-w-full truncate rounded text-left hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent">
                  {name}
                </button>
              </h3>
              <div className="flex flex-wrap items-center gap-x-2 gap-y-1 text-[11px]">
              <span title={checkedAt ? cs.customLastChecked.replace('{{time}}', checkedAt) : undefined} aria-label={checkedAt ? `${status} · ${cs.customLastChecked.replace('{{time}}', checkedAt)}` : status} className={cn('inline-flex shrink-0 items-center gap-1', !disabled && lastCheck ? 'text-emerald-700 dark:text-emerald-300' : 'text-fg-muted')}>
                <StatusIcon className="size-3.5" aria-hidden />
                {status}
              </span>
              {lastCheck ? <span className="text-fg-muted">{cs.customToolCount.replace('{{count}}', String(lastCheck.toolCount))}</span> : null}
              </div>
            </div>
          </div>
        </div>
        <p title={endpoint} className="mt-2 truncate font-mono text-xs leading-5 text-fg-muted">{endpoint}</p>
      </div>
        <div className="mt-2 flex shrink-0 items-center gap-1">
          <span className="mr-auto text-[11px] text-fg-subtle">{t.transportLabels[row.transport]}</span>
          <Button variant="ghost" className="h-8 px-2 py-1 text-xs" onClick={onEdit}>{t.setupConfigure}</Button>
          <Button ref={toolsTrigger} variant="secondary" className="h-8 px-2 py-1 text-xs shadow-none sm:shadow-none" disabled={disabled} onClick={() => setShowTools(true)}>{t.viewTools}</Button>
          <DropdownMenu.Root>
            <DropdownMenu.Trigger asChild>
              <Button variant="ghost" className="size-8 p-0" aria-label={cs.customManage.replace('{{name}}', name)} title={cs.customManage.replace('{{name}}', name)}>
                <MoreHorizontal className="size-4" aria-hidden />
              </Button>
            </DropdownMenu.Trigger>
            <DropdownMenu.Portal>
              <DropdownMenu.Content align="end" sideOffset={6} className="z-50 min-w-36 rounded-xl border border-edge bg-surface-overlay p-1 shadow-popover">
                <DropdownMenu.Item onSelect={() => setConfirm(true)} className="flex cursor-pointer items-center gap-2 rounded-lg px-3 py-2 text-sm text-danger outline-none data-[highlighted]:bg-surface-hover">
                  <Trash2 className="size-4" aria-hidden />
                  {t.removeServer}
                </DropdownMenu.Item>
              </DropdownMenu.Content>
            </DropdownMenu.Portal>
          </DropdownMenu.Root>
        </div>
      {error ? <p role="alert" className="mt-2 text-sm text-danger">{error}</p> : null}
      {showTools ? <McpToolsDialog serverId={row.id} displayName={row.displayName} returnFocusTo={toolsTrigger.current} t={t} onClose={() => setShowTools(false)} onConfigure={() => { setShowTools(false); onEdit(); }} /> : null}
      <ConfirmDialog open={confirm} title={cs.removeConfirmTitle.replace('{{name}}', name)} description={cs.removeConfirmDescription}
        confirmLabel={t.removeServer} cancelLabel={cs.modalCancel} destructive onCancel={() => setConfirm(false)}
        onConfirm={() => { setConfirm(false); setError(''); void onRemove().catch(() => setError(t.setupRemoveFailed)); }} />
    </li>
  );
}
