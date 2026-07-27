import * as Dialog from '@radix-ui/react-dialog';
import { ChevronDown, Paperclip, Plus, Settings2, Sparkles, Trash2, X } from 'lucide-react';
import { useEffect, useState } from 'react';

import { Button } from '@/components/ui/button';
import { Select, SelectGroup, SelectOption } from '@/components/ui/popover-select';
import { ComposerAttachmentChips } from '@/features/chat/composer/composer-attachment-chips';
import type { WireAttachment } from '@/features/chat/composer/composer.types';
import { useComposerAttachments } from '@/features/chat/composer/use-composer-attachments';
import type { ConfiguredModel } from '@/features/chat/api/registry-api';
import type { GatewayAgentRow } from '@/features/settings/agents-admin-api';
import {
  agentListDisplayDescription,
  agentListDisplayName,
} from '@/features/settings/agents/agent-display-names';
import type { GoalsConfigState } from '@/features/settings/goals-config-api';
import { messages } from '@/i18n/messages';
import { cn } from '@/lib/cn';
import { useLocaleStore } from '@/stores/locale-store';

import { emptyCreateDraft, normalizeChecklist } from './goal-create-draft';

export type GoalPriority = 'low' | 'normal' | 'high';
export type GoalsPageMessages = ReturnType<typeof messages>['goalsPage'];
export type ChatMessages = ReturnType<typeof messages>['chat'];

export type CreateGoalDraft = {
  title: string;
  objective: string;
  description: string;
  attachments: WireAttachment[];
  checklist: string[];
  scopeBoundary: string;
  evidencePlan: string[];
  priority: GoalPriority;
  deadlineMode: 'none' | 'today' | 'tomorrow' | 'friday' | 'custom';
  deadline: string;
  maxTurns: string;
  agentId: string;
  judgeModelRef: string;
};

export type GoalCreateOptions = {
  defaultAgentId: string;
  agents: GatewayAgentRow[];
  models: ConfiguredModel[];
  checklistDecomposePolicy: GoalsConfigState['checklistDecomposePolicy'];
};

function formatMessage(template: string, values: Record<string, string | number>): string {
  return Object.entries(values).reduce((text, [key, value]) => text.replaceAll(`{{${key}}}`, String(value)), template);
}

function formatDatetimeLocal(date: Date): string {
  const pad = (value: number) => String(value).padStart(2, '0');
  return [
    date.getFullYear(),
    '-',
    pad(date.getMonth() + 1),
    '-',
    pad(date.getDate()),
    'T',
    pad(date.getHours()),
    ':',
    pad(date.getMinutes()),
  ].join('');
}

function endOfLocalDay(offsetDays: number): string {
  const date = new Date();
  date.setDate(date.getDate() + offsetDays);
  date.setHours(23, 59, 0, 0);
  return formatDatetimeLocal(date);
}

function endOfThisFriday(): string {
  const date = new Date();
  const day = date.getDay();
  const friday = 5;
  const daysUntilFriday = day <= friday ? friday - day : 7 - day + friday;
  date.setDate(date.getDate() + daysUntilFriday);
  date.setHours(23, 59, 0, 0);
  return formatDatetimeLocal(date);
}

function nextDeadlineForMode(mode: CreateGoalDraft['deadlineMode']): string {
  if (mode === 'today') return endOfLocalDay(0);
  if (mode === 'tomorrow') return endOfLocalDay(1);
  if (mode === 'friday') return endOfThisFriday();
  if (mode === 'custom') {
    const date = new Date();
    date.setHours(date.getHours() + 1, 0, 0, 0);
    return formatDatetimeLocal(date);
  }
  return '';
}

export function GoalCreateDialog({
  open,
  t,
  chat,
  busy,
  options,
  onClose,
  onCreate,
  onDraftContract,
}: {
  open: boolean;
  t: GoalsPageMessages;
  chat: ChatMessages;
  busy: boolean;
  options: GoalCreateOptions;
  onClose: () => void;
  onCreate: (draft: CreateGoalDraft) => Promise<void>;
  onDraftContract?: (draft: CreateGoalDraft) => Promise<Pick<CreateGoalDraft, 'objective' | 'scopeBoundary' | 'evidencePlan' | 'checklist'>>;
}) {
  const language = useLocaleStore((s) => s.language);
  const agentsMessages = messages(language).agentsSettings;
  const [draft, setDraft] = useState<CreateGoalDraft>(() => emptyCreateDraft());
  const [completionOpen, setCompletionOpen] = useState(false);
  const [advancedOpen, setAdvancedOpen] = useState(false);
  const [localError, setLocalError] = useState<string | null>(null);
  const [drafting, setDrafting] = useState(false);
  const attachmentTools = useComposerAttachments({ chat });

  useEffect(() => {
    if (!open) {
      setDraft(emptyCreateDraft());
      setCompletionOpen(false);
      setAdvancedOpen(false);
      setLocalError(null);
      setDrafting(false);
      attachmentTools.clearAttachments();
    }
  }, [attachmentTools.clearAttachments, open]);

  useEffect(() => {
    if (!open || !options.defaultAgentId) return;
    setDraft((prev) => (prev.agentId ? prev : { ...prev, agentId: options.defaultAgentId }));
  }, [open, options.defaultAgentId]);

  const patch = (next: Partial<CreateGoalDraft>) => setDraft((prev) => ({ ...prev, ...next }));
  const agents: GatewayAgentRow[] = options.agents.length ? options.agents : [{
    id: options.defaultAgentId || 'main',
    workspace: '',
    profileDir: '',
    typedModels: { defaultRole: 'deep', preset: [], effective: [] },
    extends: [],
    isDefault: true,
    skills: { preset: [] },
    tools: { presetDenied: [], entryDisable: [], effectiveDisable: [] },
  } satisfies GatewayAgentRow];
  const selectedAgent = agents.find((agent) => agent.id === draft.agentId) ?? agents.find((agent) => agent.id === options.defaultAgentId) ?? agents[0];
  const selectedAgentDescription = selectedAgent
    ? agentListDisplayDescription(selectedAgent, agentsMessages)
    : '';
  const selectedAgentId = draft.agentId || selectedAgent?.id || 'main';
  const agentModelRoles = [...(selectedAgent?.typedModels.effective ?? [])].sort((a, b) => {
    if (a.id === 'judge') return -1;
    if (b.id === 'judge') return 1;
    return a.id.localeCompare(b.id);
  });
  const modelOptions = options.models.filter((model, index, all) => all.findIndex((item) => item.id === model.id) === index);
  const patchDeadlineMode = (mode: CreateGoalDraft['deadlineMode']) => {
    patch({ deadlineMode: mode, deadline: nextDeadlineForMode(mode) });
  };
  const patchChecklist = (index: number, text: string) => {
    setDraft((prev) => ({
      ...prev,
      checklist: prev.checklist.map((item, i) => (i === index ? text : item)),
    }));
  };
  const removeChecklist = (index: number) => {
    setDraft((prev) => ({ ...prev, checklist: prev.checklist.filter((_, i) => i !== index) }));
  };
  const patchEvidence = (index: number, text: string) => {
    setDraft((prev) => ({
      ...prev,
      evidencePlan: prev.evidencePlan.map((item, i) => (i === index ? text : item)),
    }));
  };
  const removeEvidence = (index: number) => {
    setDraft((prev) => ({ ...prev, evidencePlan: prev.evidencePlan.filter((_, i) => i !== index) }));
  };
  const generateContract = async () => {
    setLocalError(null);
    setDrafting(true);
    try {
      const next = onDraftContract
        ? await onDraftContract({
            ...draft,
            attachments: attachmentTools.wireAttachmentsPayload(),
          })
        : {
            objective: draft.objective || draft.title,
            scopeBoundary: draft.scopeBoundary,
            evidencePlan: normalizeChecklist(draft.evidencePlan).length
              ? draft.evidencePlan
              : [...t.createDialog.defaultEvidencePlan],
            checklist: draft.checklist,
          };
      patch(next);
      setCompletionOpen(true);
    } catch (err) {
      setLocalError(err instanceof Error ? err.message : t.createDialog.draftFailed);
    } finally {
      setDrafting(false);
    }
  };

  const submit = async () => {
    setLocalError(null);
    if (!draft.title.trim()) {
      setLocalError(t.createDialog.titleRequired);
      return;
    }
    try {
      await onCreate({
        ...draft,
        attachments: attachmentTools.wireAttachmentsPayload(),
        checklist: normalizeChecklist(draft.checklist),
      });
      onClose();
    } catch (err) {
      setLocalError(err instanceof Error ? err.message : t.errors.create);
    }
  };

  return (
    <Dialog.Root open={open} onOpenChange={(next) => !next && onClose()}>
      <Dialog.Portal>
        <Dialog.Overlay className="xopc-dialog-overlay fixed inset-0 z-65 bg-scrim backdrop-blur-[1px]" />
        <Dialog.Content className="fixed left-1/2 top-1/2 z-66 flex h-[min(92vh,46rem)] w-[min(100%-2rem,44rem)] -translate-x-1/2 -translate-y-1/2 flex-col overflow-hidden rounded-2xl border border-edge bg-surface-panel shadow-popover outline-none">
          <div className="flex shrink-0 items-center justify-between gap-2 border-b border-edge px-5 py-4">
            <div className="min-w-0">
              <Dialog.Title className="truncate text-base font-semibold tracking-tight text-fg">{t.createDialog.title}</Dialog.Title>
              <Dialog.Description className="mt-1 truncate text-sm text-fg-muted">{t.createDialog.description}</Dialog.Description>
            </div>
            <Button type="button" variant="ghost" className="size-9 shrink-0 p-0" aria-label={t.closeDetails} onClick={onClose}>
              <X className="size-5" aria-hidden />
            </Button>
          </div>

          <div className="min-h-0 flex-1 overflow-y-auto p-5">
            <div className="grid gap-4">
              <section className="rounded-lg border border-accent/25 bg-accent-soft/50 p-3">
                <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
                  <div className="min-w-0">
                    <p className="text-sm font-medium text-fg">{t.createDialog.simpleStartTitle}</p>
                    <p className="mt-1 text-xs text-fg-muted">{t.createDialog.simpleStartHint}</p>
                  </div>
                  <Button
                    type="button"
                    variant="secondary"
                    className="h-8 shrink-0 rounded-lg text-xs"
                    onClick={() => void generateContract()}
                    disabled={drafting || (!draft.title.trim() && !draft.description.trim())}
                  >
                    <Sparkles className="size-3.5" aria-hidden />
                    {drafting ? t.createDialog.drafting : t.createDialog.aiDraft}
                  </Button>
                </div>
              </section>

              <label className="grid gap-1.5">
                <span className="text-sm font-medium text-fg">{t.createDialog.goalTitle}</span>
                <input
                  value={draft.title}
                  onChange={(e) => patch({ title: e.target.value })}
                  placeholder={t.newGoalPlaceholder}
                  className="rounded-lg border border-edge bg-surface-muted px-3 py-2 text-sm text-fg placeholder:text-fg-muted focus-visible:border-accent focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-accent"
                />
              </label>

              <label className="grid gap-1.5">
                <div className="flex items-center justify-between gap-2">
                  <span className="text-sm font-medium text-fg">{t.createDialog.goalDescription}</span>
                  <Button
                    type="button"
                    variant="secondary"
                    className="h-8 rounded-lg text-xs"
                    onClick={() => attachmentTools.fileInputRef.current?.click()}
                  >
                    <Paperclip className="size-3.5" aria-hidden />
                    {t.createDialog.addAttachment}
                  </Button>
                </div>
                <textarea
                  value={draft.description}
                  onChange={(e) => patch({ description: e.target.value })}
                  placeholder={t.createDialog.descriptionPlaceholder}
                  rows={4}
                  className="resize-none rounded-lg border border-edge bg-surface-muted px-3 py-2 text-sm text-fg placeholder:text-fg-muted focus-visible:border-accent focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-accent"
                />
                <input
                  ref={attachmentTools.fileInputRef}
                  type="file"
                  multiple
                  className="hidden"
                  onChange={(event) => {
                    const files = Array.from(event.currentTarget.files ?? []);
                    event.currentTarget.value = '';
                    void attachmentTools.processFiles(files);
                  }}
                />
                <ComposerAttachmentChips
                  attachments={attachmentTools.attachments}
                  topPadded={false}
                  onRemove={attachmentTools.removeAttachment}
                />
              </label>

              <section className="rounded-2xl border border-edge-subtle bg-surface-base/60">
                <button
                  type="button"
                  className="flex w-full items-center justify-between gap-3 px-4 py-3 text-left"
                  onClick={() => setCompletionOpen((current) => !current)}
                >
                  <span className="min-w-0">
                    <span className="block text-sm font-semibold text-fg">{t.createDialog.completionPlan}</span>
                    <span className="mt-1 block text-xs text-fg-muted">{t.createDialog.completionPlanHint}</span>
                  </span>
                  <ChevronDown className={cn('size-4 shrink-0 text-fg-muted transition-transform', completionOpen && 'rotate-180')} aria-hidden />
                </button>
                {completionOpen ? (
                  <div className="grid gap-4 border-t border-edge-subtle p-4">
                    <section className="rounded-lg border border-edge-subtle bg-surface-panel/70 p-3">
                      <div>
                        <h3 className="text-sm font-semibold text-fg">{t.createDialog.criteriaTitle}</h3>
                        <p className="mt-1 text-xs text-fg-muted">{t.createDialog.criteriaHint}</p>
                        <p className="mt-1 text-xs text-fg-subtle">
                          {options.checklistDecomposePolicy === 'supplement_existing'
                            ? t.createDialog.checklistPolicySupplementExisting
                            : t.createDialog.checklistPolicyEmptyOnly}
                        </p>
                      </div>

                      <div className="mt-3 grid gap-2">
                        {draft.checklist.map((item, index) => (
                          <div key={index} className="flex gap-2">
                            <input
                              value={item}
                              onChange={(e) => patchChecklist(index, e.target.value)}
                              placeholder={formatMessage(t.createDialog.criteriaPlaceholder, { index: index + 1 })}
                              className="min-w-0 flex-1 rounded-lg border border-edge bg-surface-muted px-3 py-2 text-sm text-fg placeholder:text-fg-muted focus-visible:border-accent focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-accent"
                            />
                            <Button
                              type="button"
                              variant="ghost"
                              className="size-9 shrink-0 rounded-lg p-0"
                              aria-label={t.createDialog.removeCriteria}
                              onClick={() => removeChecklist(index)}
                            >
                              <Trash2 className="size-4" aria-hidden />
                            </Button>
                          </div>
                        ))}
                        <Button
                          type="button"
                          variant="ghost"
                          className="h-8 justify-start rounded-lg text-xs"
                          onClick={() => patch({ checklist: [...draft.checklist, ''] })}
                        >
                          <Plus className="size-3.5" aria-hidden />
                          {t.createDialog.addCriteria}
                        </Button>
                      </div>
                    </section>

                    <section className="rounded-lg border border-edge-subtle bg-surface-panel/70 p-3">
                      <h3 className="text-sm font-semibold text-fg">{t.createDialog.contractTitle}</h3>
                      <p className="mt-1 text-xs text-fg-muted">{t.createDialog.contractHint}</p>
                      <label className="mt-3 grid gap-1.5">
                        <span className="text-sm font-medium text-fg">{t.createDialog.objective}</span>
                        <textarea
                          value={draft.objective}
                          onChange={(e) => patch({ objective: e.target.value })}
                          placeholder={t.createDialog.objectivePlaceholder}
                          rows={2}
                          className="resize-none rounded-lg border border-edge bg-surface-muted px-3 py-2 text-sm text-fg placeholder:text-fg-muted focus-visible:border-accent focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-accent"
                        />
                      </label>
                      <label className="mt-3 grid gap-1.5">
                        <span className="text-sm font-medium text-fg">{t.createDialog.scopeBoundary}</span>
                        <textarea
                          value={draft.scopeBoundary}
                          onChange={(e) => patch({ scopeBoundary: e.target.value })}
                          placeholder={t.createDialog.scopeBoundaryPlaceholder}
                          rows={2}
                          className="resize-none rounded-lg border border-edge bg-surface-muted px-3 py-2 text-sm text-fg placeholder:text-fg-muted focus-visible:border-accent focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-accent"
                        />
                      </label>
                      <div className="mt-3 grid gap-1.5">
                        <span className="text-sm font-medium text-fg">{t.createDialog.evidencePlan}</span>
                        <p className="text-xs text-fg-muted">{t.createDialog.evidencePlanHint}</p>
                        {draft.evidencePlan.map((item, index) => (
                          <div key={index} className="flex gap-2">
                            <input
                              value={item}
                              onChange={(e) => patchEvidence(index, e.target.value)}
                              placeholder={formatMessage(t.createDialog.evidencePlanPlaceholder, { index: index + 1 })}
                              className="min-w-0 flex-1 rounded-lg border border-edge bg-surface-muted px-3 py-2 text-sm text-fg placeholder:text-fg-muted focus-visible:border-accent focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-accent"
                            />
                            <Button
                              type="button"
                              variant="ghost"
                              className="size-9 shrink-0 rounded-lg p-0"
                              aria-label={t.createDialog.removeEvidence}
                              onClick={() => removeEvidence(index)}
                            >
                              <Trash2 className="size-4" aria-hidden />
                            </Button>
                          </div>
                        ))}
                        <Button
                          type="button"
                          variant="ghost"
                          className="h-8 justify-start rounded-lg text-xs"
                          onClick={() => patch({ evidencePlan: [...draft.evidencePlan, ''] })}
                        >
                          <Plus className="size-3.5" aria-hidden />
                          {t.createDialog.addEvidence}
                        </Button>
                      </div>
                    </section>
                  </div>
                ) : null}
              </section>

              <section className="rounded-2xl border border-edge-subtle bg-surface-base/60">
                <button
                  type="button"
                  className="flex w-full items-center justify-between gap-3 px-4 py-3 text-left"
                  onClick={() => setAdvancedOpen((current) => !current)}
                >
                  <span className="flex items-center gap-2 text-sm font-semibold text-fg">
                    <Settings2 className="size-4 text-fg-muted" aria-hidden />
                    {t.createDialog.advanced}
                  </span>
                  <ChevronDown className={cn('size-4 text-fg-muted transition-transform', advancedOpen && 'rotate-180')} aria-hidden />
                </button>
                {advancedOpen ? (
                  <div className="grid gap-3 border-t border-edge-subtle p-4 sm:grid-cols-2">
                    <label className="grid gap-1.5 sm:col-span-2">
                      <span className="text-sm font-medium text-fg">{t.createDialog.agentId}</span>
                      <Select
                        value={selectedAgentId}
                        onChange={(e) => patch({ agentId: e.target.value })}
                        className="rounded-lg border border-edge bg-surface-muted px-3 py-2 text-sm text-fg focus-visible:border-accent focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-accent"
                      >
                        {agents.map((agent) => (
                          <SelectOption key={agent.id} value={agent.id}>
                            {agentListDisplayName(agent, agentsMessages) + (agent.isDefault ? ` · ${t.createDialog.defaultAgent}` : ` · ${agent.id}`)}
                          </SelectOption>
                        ))}
                      </Select>
                      {selectedAgentDescription ? (
                        <span className="line-clamp-2 text-xs text-fg-muted">
                          {selectedAgentDescription}
                        </span>
                      ) : selectedAgent?.model?.primary ? (
                        <span className="truncate text-xs text-fg-muted">{formatMessage(t.createDialog.agentPrimaryModel, { model: selectedAgent.model.primary })}</span>
                      ) : null}
                    </label>
                    <label className="grid gap-1.5">
                      <span className="text-sm font-medium text-fg">{t.createDialog.priority}</span>
                      <Select
                        value={draft.priority}
                        onChange={(e) => patch({ priority: e.target.value as GoalPriority })}
                        className="rounded-lg border border-edge bg-surface-muted px-3 py-2 text-sm text-fg focus-visible:border-accent focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-accent"
                      >
                        <SelectOption value="normal">{t.priorities.normal}</SelectOption>
                        <SelectOption value="high">{t.priorities.high}</SelectOption>
                        <SelectOption value="low">{t.priorities.low}</SelectOption>
                      </Select>
                    </label>
                    <label className="grid gap-1.5">
                      <span className="text-sm font-medium text-fg">{t.createDialog.deadline}</span>
                      <Select
                        value={draft.deadlineMode}
                        onChange={(e) => patchDeadlineMode(e.target.value as CreateGoalDraft['deadlineMode'])}
                        className="rounded-lg border border-edge bg-surface-muted px-3 py-2 text-sm text-fg focus-visible:border-accent focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-accent"
                      >
                        <SelectOption value="none">{t.createDialog.deadlineNone}</SelectOption>
                        <SelectOption value="today">{t.createDialog.deadlineToday}</SelectOption>
                        <SelectOption value="tomorrow">{t.createDialog.deadlineTomorrow}</SelectOption>
                        <SelectOption value="friday">{t.createDialog.deadlineFriday}</SelectOption>
                        <SelectOption value="custom">{t.createDialog.deadlineCustom}</SelectOption>
                      </Select>
                    </label>
                    {draft.deadlineMode !== 'none' ? (
                      <label className="grid gap-1.5">
                        <span className="text-sm font-medium text-fg">{t.createDialog.deadlineAt}</span>
                        <input
                          type="datetime-local"
                          value={draft.deadline}
                          onChange={(e) => patch({ deadline: e.target.value, deadlineMode: 'custom' })}
                          className="rounded-lg border border-edge bg-surface-muted px-3 py-2 text-sm text-fg focus-visible:border-accent focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-accent"
                        />
                      </label>
                    ) : null}
                    <label className="grid gap-1.5">
                      <span className="text-sm font-medium text-fg">{t.createDialog.maxTurns}</span>
                      <input
                        type="number"
                        min={1}
                        max={500}
                        value={draft.maxTurns}
                        onChange={(e) => patch({ maxTurns: e.target.value })}
                        className="rounded-lg border border-edge bg-surface-muted px-3 py-2 text-sm text-fg focus-visible:border-accent focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-accent"
                      />
                    </label>
                    <label className="grid gap-1.5 sm:col-span-2">
                      <span className="text-sm font-medium text-fg">{t.createDialog.judgeModel}</span>
                      <Select
                        value={draft.judgeModelRef}
                        onChange={(e) => patch({ judgeModelRef: e.target.value })}
                        className="rounded-lg border border-edge bg-surface-muted px-3 py-2 text-sm text-fg focus-visible:border-accent focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-accent"
                      >
                        <SelectOption value="">{t.createDialog.judgeModelPlaceholder}</SelectOption>
                        {agentModelRoles.length ? (
                          <SelectGroup label={t.createDialog.agentModelRoles}>
                            {agentModelRoles.map((role) => (
                              <SelectOption key={`${role.id}:${role.model}`} value={role.model}>
                                {role.id === 'judge' ? t.createDialog.judgeRole : role.id} · {role.model}
                              </SelectOption>
                            ))}
                          </SelectGroup>
                        ) : null}
                        <SelectGroup label={t.createDialog.configuredModels}>
                          {modelOptions.map((model) => (
                            <SelectOption key={model.id} value={model.id}>
                              {model.name} · {model.id}
                            </SelectOption>
                          ))}
                        </SelectGroup>
                      </Select>
                    </label>
                  </div>
                ) : null}
              </section>

              {localError ? <p className="rounded-lg border border-destructive/40 bg-destructive/10 px-3 py-2 text-sm text-destructive">{localError}</p> : null}
            </div>
          </div>

          <div className="flex shrink-0 items-center justify-end gap-2 border-t border-edge px-5 py-4">
            <Button type="button" variant="ghost" className="rounded-lg" onClick={onClose}>
              {t.createDialog.cancel}
            </Button>
            <Button type="button" variant="primary" className="rounded-lg" disabled={busy || !draft.title.trim()} onClick={() => void submit()}>
              <Plus className="size-4" aria-hidden />
              {t.createDialog.create}
            </Button>
          </div>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}
