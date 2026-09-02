import * as Dialog from '@radix-ui/react-dialog';
import { X } from 'lucide-react';
import { type ReactNode, useState } from 'react';

import { AgentAvatarDisplay } from '@/features/settings/agents/agent-avatar-display';
import type { GatewayAgentRow } from '@/features/settings/types/agent-gateway';
import { cn } from '@/lib/cn';
import { SETTINGS_SHELL_CONTENT_Z, SETTINGS_SHELL_OVERLAY_Z } from '@/lib/settings-shell-dialog-layer';
import { SettingsShellLayerProvider } from '@/lib/settings-shell-layer-context';

export function AgentsEditorModal({
  agent,
  open,
  onOpenChange,
  children,
}: {
  agent: GatewayAgentRow;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  children: ReactNode;
}) {
  const [portalContainer, setPortalContainer] = useState<HTMLDivElement | null>(null);

  return (
    <Dialog.Root open={open} onOpenChange={onOpenChange}>
      <Dialog.Portal>
        <Dialog.Overlay className={cn('xopc-dialog-overlay fixed inset-0 bg-scrim', SETTINGS_SHELL_OVERLAY_Z)} />
        <Dialog.Content
          ref={setPortalContainer}
          className={cn(
            'xopc-dialog-content fixed flex flex-col overflow-hidden rounded-2xl border border-edge bg-surface-panel shadow-popover',
            SETTINGS_SHELL_CONTENT_Z,
            'inset-3 h-[calc(100dvh-1.5rem)] min-h-0 sm:inset-auto sm:left-1/2 sm:top-1/2',
            'sm:h-[min(88vh,48rem)] sm:w-[min(94vw,62rem)] sm:-translate-x-1/2 sm:-translate-y-1/2',
          )}
          onOpenAutoFocus={(event) => event.preventDefault()}
        >
          <SettingsShellLayerProvider layer="modal" portalContainer={portalContainer}>
            <header className="flex shrink-0 items-center justify-between gap-4 border-b border-edge px-5 py-4">
              <div className="flex min-w-0 items-center gap-3">
                <AgentAvatarDisplay agentId={agent.id} avatar={agent.avatar} size={42} className="size-11 shrink-0" />
                <div className="min-w-0">
                  <Dialog.Title className="truncate text-base font-semibold text-fg">{agent.name}</Dialog.Title>
                  <Dialog.Description className="mt-0.5 truncate font-mono text-xs text-fg-muted">{agent.id}</Dialog.Description>
                </div>
                {agent.isDefault ? <span className="rounded-full bg-accent-soft px-2 py-0.5 text-[11px] font-medium text-accent">DEFAULT</span> : null}
              </div>
              <Dialog.Close asChild>
                <button type="button" className="rounded-lg p-2 text-fg-muted hover:bg-surface-hover hover:text-fg" aria-label="Close">
                  <X className="size-4" />
                </button>
              </Dialog.Close>
            </header>
            {children}
          </SettingsShellLayerProvider>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}
