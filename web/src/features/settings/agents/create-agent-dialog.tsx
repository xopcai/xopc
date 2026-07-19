import * as Dialog from '@radix-ui/react-dialog';
import { UserPlus, X } from 'lucide-react';
import { useState, type FormEvent } from 'react';

import { Button } from '@/components/ui/button';
import { Select, SelectOption } from '@/components/ui/popover-select';
import { ModelSelector } from '@/features/chat/model/model-selector';
import type { GatewayAgentRow } from '@/features/settings/agents-admin-api';
import type { CapabilityPresetRow } from '@/features/settings/capability-presets/capability-presets-api';
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
  capabilityPlans: CapabilityPresetRow[];
  defaultPresetId: string;
  selectedCapabilityPlanIds: string[];
  onSelectedCapabilityPlanIdsChange: (ids: string[]) => void;
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
    capabilityPlans,
    defaultPresetId,
    selectedCapabilityPlanIds,
    onSelectedCapabilityPlanIdsChange,
  } = props;
  const [portalContainer, setPortalContainer] = useState<HTMLDivElement | null>(null);

  return (
    <Dialog.Root open={open} onOpenChange={onOpenChange}>
      <Dialog.Portal>
        <Dialog.Overlay
          className={cn('xopc-dialog-overlay fixed inset-0 bg-scrim', SETTINGS_SHELL_OVERLAY_Z)}
        />
        <Dialog.Content
          ref={setPortalContainer}
          className={cn(
            'xopc-dialog-content fixed left-1/2 top-1/2 flex h-[min(90vh,680px)] w-[min(100%-2rem,28rem)] -translate-x-1/2 -translate-y-1/2 flex-col',
            SETTINGS_SHELL_CONTENT_Z,
            'overflow-hidden rounded-xl border border-edge bg-surface-panel p-4 shadow-popover dark:border-edge',
          )}
          onOpenAutoFocus={(e) => e.preventDefault()}
        >
          <SettingsShellLayerProvider layer="modal" portalContainer={portalContainer}>
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

          <form className="flex min-h-0 flex-1 flex-col" onSubmit={onCreate}>
            <div className="grid min-h-0 flex-1 gap-3 overflow-y-auto pr-1">
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

            <div className="rounded-lg border border-edge-subtle bg-surface-base p-3 dark:border-edge">
              <div className="text-sm font-medium text-fg">{a.createCapabilityPlansTitle}</div>
              <p className="mt-1 text-xs leading-relaxed text-fg-muted">{a.createCapabilityPlansHint}</p>
              <div className="mt-2 rounded-md bg-accent/5 px-2.5 py-2 text-xs text-fg-muted">
                {capabilityPlans.find((plan) => plan.id === defaultPresetId)?.name ?? a.capabilityPresetsGlobalDefault}
              </div>
              <div className="mt-2 grid gap-2">
                {capabilityPlans
                  .filter((plan) => plan.id !== defaultPresetId)
                  .map((plan) => {
                    const checked = selectedCapabilityPlanIds.includes(plan.id);
                    return (
                      <label key={plan.id} className="flex cursor-pointer items-start gap-2 rounded-md bg-surface-panel px-2.5 py-2">
                        <input
                          type="checkbox"
                          className="mt-0.5 shrink-0 rounded border-edge"
                          checked={checked}
                          disabled={busy}
                          onChange={() =>
                            onSelectedCapabilityPlanIdsChange(
                              checked
                                ? selectedCapabilityPlanIds.filter((id) => id !== plan.id)
                                : [...selectedCapabilityPlanIds, plan.id],
                            )
                          }
                        />
                        <span className="min-w-0">
                          <span className="block text-sm font-medium text-fg">{plan.name}</span>
                          {plan.description ? (
                            <span className="mt-0.5 line-clamp-2 block text-xs text-fg-muted">{plan.description}</span>
                          ) : null}
                        </span>
                      </label>
                    );
                  })}
              </div>
            </div>

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
            </div>
            <div className="mt-3 flex shrink-0 justify-end gap-2 border-t border-edge-subtle pt-3 dark:border-edge">
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
