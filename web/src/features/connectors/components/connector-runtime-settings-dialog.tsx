import * as Dialog from '@radix-ui/react-dialog';
import { Loader2, Plug, X } from 'lucide-react';

import { Button } from '@/components/ui/button';
import type { ConnectorsSettingsMessages, McpSettingsMessages } from '@/i18n/messages';
import { cn } from '@/lib/cn';
import { settingsInputFocusClass } from '@/lib/form-field-width';
import { interaction } from '@/lib/interaction';

const inputClass = cn(
  'w-full rounded-lg border border-edge bg-surface-panel px-3 py-2 text-sm text-fg',
  'placeholder:text-fg-subtle',
  settingsInputFocusClass,
);

export function ConnectorRuntimeSettingsDialog({
  open,
  sessionIdleTtlMinutes,
  saving,
  onChange,
  onSave,
  onClose,
  t,
  mcp,
}: {
  open: boolean;
  sessionIdleTtlMinutes: number | undefined;
  saving: boolean;
  onChange: (value: number | undefined) => void;
  onSave: () => Promise<void>;
  onClose: () => void;
  t: ConnectorsSettingsMessages;
  mcp: McpSettingsMessages;
}) {
  return (
    <Dialog.Root open={open} onOpenChange={(nextOpen) => { if (!nextOpen) onClose(); }}>
      <Dialog.Portal>
        <Dialog.Overlay className="xopc-dialog-overlay fixed inset-0 z-[60] bg-scrim" />
        <Dialog.Content
          className={cn(
            'xopc-dialog-content fixed left-1/2 top-1/2 z-[60] flex h-[min(32rem,calc(100vh-2rem))] w-[min(100%-2rem,38rem)] -translate-x-1/2 -translate-y-1/2 flex-col overflow-hidden',
            'rounded-2xl border border-edge bg-surface-panel shadow-float dark:border-edge',
          )}
        >
          <div className="flex shrink-0 items-start justify-between gap-3 border-b border-edge-subtle px-6 py-5">
            <div className="flex min-w-0 items-start gap-3">
              <span className="flex size-10 shrink-0 items-center justify-center rounded-xl bg-accent-soft text-accent-fg">
                <Plug className="size-5" strokeWidth={1.75} aria-hidden />
              </span>
              <div className="min-w-0">
                <Dialog.Title className="text-base font-semibold text-fg">{t.runtimeSettingsTitle}</Dialog.Title>
                <Dialog.Description className="mt-1 text-sm text-fg-muted">{t.runtimeSettingsHint}</Dialog.Description>
              </div>
            </div>
            <Dialog.Close asChild>
              <button
                type="button"
                className={cn('rounded-lg p-1.5 text-fg-muted hover:bg-surface-hover hover:text-fg', interaction.focusRingPanel)}
                aria-label={t.modalClose}
              >
                <X className="size-5" strokeWidth={1.75} aria-hidden />
              </button>
            </Dialog.Close>
          </div>

          <div className="min-h-0 flex-1 overflow-y-auto px-6 py-5">
            <label className="flex max-w-xl flex-col gap-1.5">
              <span className="text-sm font-medium text-fg">{mcp.idleTtlLabel}</span>
              <input
                type="number"
                min={0}
                className={cn(inputClass, 'w-40 flex-none')}
                value={sessionIdleTtlMinutes ?? ''}
                placeholder={mcp.idleTtlPlaceholder}
                onChange={(event) => {
                  const raw = event.currentTarget.value.trim();
                  onChange(raw === '' ? undefined : Number.parseInt(raw, 10));
                }}
              />
              <span className="text-xs text-fg-subtle">{mcp.idleTtlHint}</span>
            </label>
          </div>

          <div className="flex shrink-0 justify-end gap-2 border-t border-edge-subtle px-6 py-4">
            <Button type="button" variant="secondary" disabled={saving} onClick={onClose}>{t.modalCancel}</Button>
            <Button type="button" variant="primary" disabled={saving} onClick={() => void onSave()}>
              {saving ? <Loader2 className="size-4 animate-spin" aria-hidden /> : null}
              {mcp.save}
            </Button>
          </div>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}
