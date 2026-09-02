import * as Dialog from '@radix-ui/react-dialog';
import { X } from 'lucide-react';

import { Button } from '@/components/ui/button';
import { cn } from '@/lib/cn';
import { SETTINGS_SHELL_CONTENT_Z, SETTINGS_SHELL_OVERLAY_Z } from '@/lib/settings-shell-dialog-layer';

const inputClass = 'w-full rounded-xl border border-edge bg-surface-base px-3 py-2.5 text-sm text-fg outline-none focus:border-accent focus:ring-2 focus:ring-accent/15';

export function CreateAgentDialog({
  open,
  busy,
  error,
  name,
  instructions,
  zh,
  onNameChange,
  onInstructionsChange,
  onCreate,
  onOpenChange,
}: {
  open: boolean;
  busy: boolean;
  error: string | null;
  name: string;
  instructions: string;
  zh: boolean;
  onNameChange: (value: string) => void;
  onInstructionsChange: (value: string) => void;
  onCreate: () => void;
  onOpenChange: (open: boolean) => void;
}) {
  return (
    <Dialog.Root open={open} onOpenChange={onOpenChange}>
      <Dialog.Portal>
        <Dialog.Overlay className={cn('xopc-dialog-overlay fixed inset-0 bg-scrim', SETTINGS_SHELL_OVERLAY_Z)} />
        <Dialog.Content className={cn(
          'xopc-dialog-content fixed left-1/2 top-1/2 w-[min(92vw,32rem)] -translate-x-1/2 -translate-y-1/2',
          'overflow-hidden rounded-2xl border border-edge bg-surface-panel shadow-popover',
          SETTINGS_SHELL_CONTENT_Z,
        )}>
          <header className="flex items-start justify-between gap-4 border-b border-edge px-5 py-4">
            <div>
              <Dialog.Title className="text-base font-semibold text-fg">{zh ? '新建 Agent' : 'Create agent'}</Dialog.Title>
              <Dialog.Description className="mt-1 text-sm text-fg-muted">
                {zh ? '只设置身份即可开始，所有能力自动继承全局配置。' : 'Set its identity and start. Every capability inherits globally.'}
              </Dialog.Description>
            </div>
            <Dialog.Close asChild><button type="button" className="rounded-lg p-2 text-fg-muted hover:bg-surface-hover" aria-label="Close"><X className="size-4" /></button></Dialog.Close>
          </header>
          <div className="space-y-4 p-5">
            {error ? <p className="rounded-lg bg-red-500/10 px-3 py-2 text-sm text-red-600">{error}</p> : null}
            <label htmlFor="create-agent-name" className="block text-xs font-medium text-fg-muted">
              {zh ? '名称' : 'Name'}
              <input id="create-agent-name" aria-label={zh ? 'Agent 名称' : 'Agent name'} className={`${inputClass} mt-1.5`} value={name} onChange={(event) => onNameChange(event.target.value)} placeholder={zh ? '例如：数据分析师' : 'For example: Data analyst'} />
            </label>
            <label htmlFor="create-agent-instructions" className="block text-xs font-medium text-fg-muted">
              {zh ? '个性与工作方式（可选）' : 'Personality and working style (optional)'}
              <textarea id="create-agent-instructions" aria-label={zh ? '个性与工作方式' : 'Personality and working style'} rows={4} className={`${inputClass} mt-1.5 resize-none`} value={instructions} onChange={(event) => onInstructionsChange(event.target.value)} placeholder={zh ? '描述角色、语气和偏好的工作方式' : 'Describe its role, tone, and preferred way of working'} />
            </label>
          </div>
          <footer className="flex justify-end gap-2 border-t border-edge px-5 py-4">
            <Dialog.Close asChild><Button disabled={busy}>{zh ? '取消' : 'Cancel'}</Button></Dialog.Close>
            <Button variant="primary" disabled={busy || !name.trim()} onClick={onCreate}>{busy ? (zh ? '创建中…' : 'Creating…') : (zh ? '创建 Agent' : 'Create agent')}</Button>
          </footer>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}
