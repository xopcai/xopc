import * as Dialog from '@radix-ui/react-dialog';
import { UserPlus, X } from 'lucide-react';
import { type FormEvent } from 'react';

import { Button } from '@/components/ui/button';
import { ModelSelector } from '@/features/chat/model/model-selector';
import type { GatewayAgentRow } from '@/features/settings/agents-admin-api';
import type { AgentsSettingsMessages, ChatMessages } from '@/i18n/messages';
import { cn } from '@/lib/cn';
import { ghostIconButton } from '@/lib/interaction';
import {
  SETTINGS_SHELL_CONTENT_Z,
  SETTINGS_SHELL_OVERLAY_Z,
} from '@/lib/settings-shell-dialog-layer';
import { SettingsShellLayerProvider } from '@/lib/settings-shell-layer-context';
import { agentListDisplayName } from './agent-display-names';
import { agentsSettingsInputClass } from './utils';
import { Select, SelectOption } from '@/components/ui/popover-select';

export function CreateAgentDialog(props: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  a: AgentsSettingsMessages;
  chat: ChatMessages;
  busy: boolean;
  modalError: string | null;
  profileLanguageLabel: string;
  createDisplayName: string;
  setCreateDisplayName: (v: string) => void;
  createAgentId: string;
  setCreateAgentId: (v: string) => void;
  createDescription: string;
  setCreateDescription: (v: string) => void;
  createWorkspace: string;
  setCreateWorkspace: (v: string) => void;
  createModel: string;
  setCreateModel: (v: string) => void;
  onCreate: (e: FormEvent) => void;
  onSuggestWorkspace: () => void;
  agents: GatewayAgentRow[];
  duplicateSourceId: string | null;
  onSelectDuplicateSource: (id: string | null) => void;
}) {
  const {
    open,
    onOpenChange,
    a,
    chat,
    busy,
    modalError,
    profileLanguageLabel,
    createDisplayName,
    setCreateDisplayName,
    createAgentId,
    setCreateAgentId,
    createDescription,
    setCreateDescription,
    createWorkspace,
    setCreateWorkspace,
    createModel,
    setCreateModel,
    onCreate,
    onSuggestWorkspace,
    agents,
    duplicateSourceId,
    onSelectDuplicateSource,
  } = props;

  return (
    <Dialog.Root open={open} onOpenChange={onOpenChange}>
      <Dialog.Portal>
        <Dialog.Overlay
          className={cn('xopc-dialog-overlay fixed inset-0 bg-scrim', SETTINGS_SHELL_OVERLAY_Z)}
        />
        <Dialog.Content
          className={cn(
            'xopc-dialog-content fixed left-1/2 top-1/2 max-h-[min(90vh,640px)] w-[min(100%-2rem,28rem)] -translate-x-1/2 -translate-y-1/2',
            SETTINGS_SHELL_CONTENT_Z,
            'overflow-y-auto rounded-xl border border-edge bg-surface-panel p-4 shadow-popover dark:border-edge',
          )}
          onOpenAutoFocus={(e) => e.preventDefault()}
        >
          <SettingsShellLayerProvider layer="modal">
          <div className="mb-3 flex items-start justify-between gap-2">
            <div className="min-w-0 pr-2">
              <Dialog.Title className="text-base font-semibold text-fg">{a.addAgent}</Dialog.Title>
              <Dialog.Description className="mt-0.5 text-xs text-fg-muted">{a.addAgentHint}</Dialog.Description>
            </div>
            <Dialog.Close asChild>
              <button
                type="button"
                className={cn(ghostIconButton, 'shrink-0 p-1.5 hover:bg-surface-base')}
                aria-label={a.closeDialogAria}
              >
                <X className="size-4" aria-hidden />
              </button>
            </Dialog.Close>
          </div>

          <form className="grid gap-3" onSubmit={onCreate}>
            {agents.length > 0 ? (
              <label className="flex flex-col gap-1 text-sm">
                <span className="text-fg-muted">{a.copyFromExistingAgent}</span>
                <Select
                  className={cn(agentsSettingsInputClass(), 'bg-surface-panel')}
                  value={duplicateSourceId ?? ''}
                  onChange={(event) => onSelectDuplicateSource(event.target.value || null)}
                >
                  <SelectOption value="">{a.copyFromExistingAgentNone}</SelectOption>
                  {agents.map((agent) => (
                    <SelectOption key={agent.id} value={agent.id}>
                      {agentListDisplayName(agent, a)} · {agent.id}
                    </SelectOption>
                  ))}
                </Select>
                <span className="text-xs text-fg-muted">{a.duplicateAgentHint}</span>
              </label>
            ) : null}

            {modalError ? (
              <div
                role="alert"
                className="rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-800 dark:border-red-900/50 dark:bg-red-950/40 dark:text-red-200"
              >
                {modalError}
              </div>
            ) : null}
            <label className="flex flex-col gap-1 text-sm">
              <span className="text-fg-muted">{a.newAgentLabel} ({profileLanguageLabel})</span>
              <input
                className={agentsSettingsInputClass()}
                value={createDisplayName}
                onChange={(e) => setCreateDisplayName(e.target.value)}
                onBlur={() => onSuggestWorkspace()}
                required
                autoComplete="off"
              />
            </label>
            <label className="flex flex-col gap-1 text-sm">
              <span className="text-fg-muted">{a.newAgentIdOptional}</span>
              <input
                className={cn(agentsSettingsInputClass(), 'font-mono text-xs')}
                value={createAgentId}
                onChange={(e) => setCreateAgentId(e.target.value)}
                onBlur={() => onSuggestWorkspace()}
                placeholder={a.newAgentIdPlaceholder}
                autoComplete="off"
                spellCheck={false}
                maxLength={64}
                pattern="[A-Za-z0-9][A-Za-z0-9_-]{0,63}"
                title={a.newAgentIdRules}
              />
              <span className="text-xs text-fg-muted">{a.newAgentIdRules}</span>
            </label>
            <label className="flex flex-col gap-1 text-sm">
              <span className="text-fg-muted">{a.agentDescription} ({profileLanguageLabel})</span>
              <textarea
                className={cn(agentsSettingsInputClass(), 'min-h-18 resize-y font-sans text-sm leading-relaxed')}
                value={createDescription}
                onChange={(e) => setCreateDescription(e.target.value)}
                placeholder={a.agentDescriptionPlaceholder}
                maxLength={4000}
                rows={3}
                spellCheck
              />
            </label>
            <label className="flex flex-col gap-1 text-sm">
              <span className="text-fg-muted">{a.newWorkspace}</span>
              <input
                className={cn(agentsSettingsInputClass(), 'font-mono text-xs')}
                value={createWorkspace}
                onChange={(e) => setCreateWorkspace(e.target.value)}
                required
                autoComplete="off"
              />
            </label>
            <div className="flex flex-col gap-1 text-sm">
              <span className="text-fg-muted">{a.newModelOptional}</span>
              <div className="flex flex-wrap items-stretch gap-2">
                <ModelSelector
                  className="min-w-0 flex-1"
                  value={createModel}
                  disabled={busy}
                  placeholder={chat.modelPlaceholder}
                  searchPlaceholder={chat.modelSearchPlaceholder}
                  noMatches={chat.modelNoMatches}
                  onChange={(id) => setCreateModel(id)}
                />
                {createModel.trim() ? (
                  <Button
                    type="button"
                    variant="secondary"
                    className="shrink-0"
                    disabled={busy}
                    onClick={() => setCreateModel('')}
                  >
                    {a.modelClear}
                  </Button>
                ) : null}
              </div>
            </div>
            <div className="mt-1 flex justify-end gap-2 border-t border-edge-subtle pt-3 dark:border-edge">
              <Dialog.Close asChild>
                <Button type="button" variant="secondary" disabled={busy}>
                  {a.createModalCancel}
                </Button>
              </Dialog.Close>
              <Button type="submit" disabled={busy}>
                <UserPlus className="mr-1 size-4" aria-hidden />
                {a.create}
              </Button>
            </div>
          </form>
          </SettingsShellLayerProvider>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}
