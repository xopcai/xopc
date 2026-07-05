import * as Dialog from '@radix-ui/react-dialog';
import { AlertTriangle, Braces, CheckCircle2, Code2, Sparkles } from 'lucide-react';
import { useEffect, useMemo, useState } from 'react';
import type { ReactNode } from 'react';

import { Button } from '@/components/ui/button';
import { messages } from '@/i18n/messages';
import type { StoredLanguage } from '@/lib/storage';

import {
  createWorkflowDraft,
  validateWorkflowDefinition,
  type ValidateWorkflowDefinitionResponse,
  type WorkflowDefinition,
  type WorkflowDraftConstraints,
  type WorkflowDraftResponse,
} from './workflow-api';
import { Select, SelectOption } from '@/components/ui/popover-select';

type WorkflowsMessages = ReturnType<typeof messages>['workflows'];
type CreateMode = 'ai' | 'manual';

export interface WorkflowEditorInitialDraft {
  mode: 'edit' | 'copy';
  name: string;
  script: string;
  sourceTitle: string;
}

const DEFAULT_SCRIPT = `export const meta = {
  name: 'my_workflow',
  description: 'Describe what this workflow does.',
  whenToUse: 'When the user asks for ...',
  examplePrompts: [
    { field: 'goal', text: 'Example goal for this workflow' },
  ],
  tags: ['custom'],
  estimatedAgents: { min: 2, max: 4 },
  phases: [{ title: 'Step 1' }, { title: 'Synthesize' }],
}

phase('Step 1')
const first = await agent('Do the first step.', { label: 'step 1' })

phase('Synthesize')
return await agent('Summarize:\\n\\n' + first, { label: 'synthesis' })
`;

export function WorkflowCreateDialog({
  open,
  language,
  ownerAgentId,
  saving,
  initialDraft,
  onClose,
  onSave,
  onSaveAndStart,
}: {
  open: boolean;
  language: StoredLanguage;
  ownerAgentId?: string;
  saving: boolean;
  initialDraft?: WorkflowEditorInitialDraft | null;
  onClose: () => void;
  onSave: (payload: { name: string; script: string }) => Promise<WorkflowDefinition | void> | WorkflowDefinition | void;
  onSaveAndStart: (payload: { name: string; script: string; goal: string }) => Promise<void> | void;
}) {
  const labels = messages(language).workflows;
  const [mode, setMode] = useState<CreateMode>('ai');
  const [workflowName, setWorkflowName] = useState('');
  const [workflowScript, setWorkflowScript] = useState('');
  const editingExisting = initialDraft?.mode === 'edit';
  const title = editingExisting ? labels.editWorkflowTitle : labels.createWorkflowTitle;
  const hint = editingExisting
    ? labels.editWorkflowHint
    : initialDraft?.mode === 'copy'
      ? labels.createWorkflowHintFromCopy
      : labels.createWorkflowHint;

  useEffect(() => {
    if (!open) return;
    setMode(initialDraft ? 'manual' : 'ai');
    setWorkflowName(initialDraft?.name ?? '');
    setWorkflowScript(initialDraft?.script ?? '');
  }, [initialDraft, open]);

  return (
    <Dialog.Root open={open} onOpenChange={(next) => !next && onClose()}>
      <Dialog.Portal>
        <Dialog.Overlay className="xopc-dialog-overlay fixed inset-0 z-65 bg-scrim backdrop-blur-[1px]" />
        <Dialog.Content className="fixed left-1/2 top-1/2 z-66 flex h-[min(92vh,52rem)] w-[min(100%-2rem,72rem)] -translate-x-1/2 -translate-y-1/2 flex-col overflow-hidden rounded-2xl border border-edge bg-surface-panel shadow-popover outline-none">
          <div className="border-b border-edge px-5 py-4">
            <Dialog.Title className="text-base font-semibold text-fg">{title}</Dialog.Title>
            <Dialog.Description className="mt-1 text-sm text-fg-muted">{hint}</Dialog.Description>
            <div className="mt-4 inline-flex rounded-xl border border-edge bg-surface-base p-1">
              <ModeButton active={mode === 'ai'} onClick={() => setMode('ai')} icon={<Sparkles className="size-4" aria-hidden />}>
                {labels.createWorkflowAiTab}
              </ModeButton>
              <ModeButton active={mode === 'manual'} onClick={() => setMode('manual')} icon={<Code2 className="size-4" aria-hidden />}>
                {labels.createWorkflowManualTab}
              </ModeButton>
            </div>
          </div>

          {mode === 'ai' ? (
            <AiCreatePane
              language={language}
              ownerAgentId={ownerAgentId}
              saving={saving}
              initialDraft={initialDraft}
              name={workflowName}
              setName={setWorkflowName}
              script={workflowScript}
              setScript={setWorkflowScript}
              onClose={onClose}
              onSave={onSave}
              onSaveAndStart={onSaveAndStart}
            />
          ) : (
            <ManualCreatePane
              language={language}
              saving={saving}
              initialDraft={initialDraft}
              name={workflowName}
              setName={setWorkflowName}
              script={workflowScript}
              setScript={setWorkflowScript}
              onClose={onClose}
              onSave={onSave}
            />
          )}
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}

function ModeButton({
  active,
  onClick,
  icon,
  children,
}: {
  active: boolean;
  onClick: () => void;
  icon: ReactNode;
  children: ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={
        active
          ? 'inline-flex h-8 items-center gap-2 rounded-lg bg-surface-panel px-3 text-sm font-medium text-fg shadow-surface'
          : 'inline-flex h-8 items-center gap-2 rounded-lg px-3 text-sm font-medium text-fg-muted hover:text-fg'
      }
    >
      {icon}
      {children}
    </button>
  );
}

function AiCreatePane({
  language,
  ownerAgentId,
  saving,
  initialDraft,
  name,
  setName,
  script,
  setScript,
  onClose,
  onSave,
  onSaveAndStart,
}: {
  language: StoredLanguage;
  ownerAgentId?: string;
  saving: boolean;
  initialDraft?: WorkflowEditorInitialDraft | null;
  name: string;
  setName: (value: string) => void;
  script: string;
  setScript: (value: string) => void;
  onClose: () => void;
  onSave: (payload: { name: string; script: string }) => Promise<WorkflowDefinition | void> | WorkflowDefinition | void;
  onSaveAndStart: (payload: { name: string; script: string; goal: string }) => Promise<void> | void;
}) {
  const labels = messages(language).workflows;
  const [prompt, setPrompt] = useState('');
  const [draft, setDraft] = useState<WorkflowDraftResponse | null>(null);
  const [constraints, setConstraints] = useState<WorkflowDraftConstraints>({
    allowNetwork: false,
    fileSystem: 'read',
    maxPhases: 4,
    maxSubagents: 8,
    outputFormat: 'report',
  });
  const [generating, setGenerating] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const validationIssues = useMemo(() => draft?.validation.errors.map((issue) => issue.message) ?? [], [draft]);
  const blockingLint = useMemo(() => draft?.lint.filter((issue) => issue.severity === 'error') ?? [], [draft]);
  const canGenerate = prompt.trim().length > 0 && !generating;
  const canSave = Boolean(draft && name.trim() && script.trim() && draft.validation.valid && blockingLint.length === 0 && !saving);
  const hasExistingScript = script.trim().length > 0;
  const promptLabel = hasExistingScript ? labels.nlBuilderEditPromptLabel : labels.nlBuilderPromptLabel;
  const promptPlaceholder = hasExistingScript ? labels.nlBuilderEditPromptPlaceholder : labels.nlBuilderPromptPlaceholder;
  const primaryGenerateMode: 'create' | 'improve' = hasExistingScript ? 'improve' : 'create';

  const generate = async (mode: 'create' | 'improve') => {
    if (!prompt.trim()) return;
    setGenerating(true);
    setError(null);
    try {
      const next = await createWorkflowDraft({
        prompt,
        agentId: ownerAgentId,
        language: language === 'zh' ? 'zh' : 'en',
        mode,
        existingScript: mode === 'improve' ? script : undefined,
        constraints,
      });
      setDraft(next);
      setName(next.name);
      setScript(next.script);
    } catch (err) {
      setError(err instanceof Error ? err.message : labels.nlBuilderGenerateFailed);
    } finally {
      setGenerating(false);
    }
  };

  const saveOnly = async () => {
    if (!canSave) return;
    const saved = await onSave({ name: name.trim(), script });
    if (saved) onClose();
  };

  const saveAndStart = async () => {
    if (!canSave) return;
    await onSaveAndStart({ name: name.trim(), script, goal: prompt.trim() });
  };

  return (
    <>
      <div className="grid min-h-0 flex-1 gap-4 overflow-auto px-5 py-4 lg:grid-cols-[minmax(18rem,0.9fr)_minmax(24rem,1.4fr)]">
        <section className="space-y-3">
          <label className="block">
            <span className="text-xs font-medium text-fg">{promptLabel}</span>
            <textarea
              value={prompt}
              onChange={(event) => setPrompt(event.target.value)}
              placeholder={promptPlaceholder}
              className="mt-1.5 min-h-36 w-full resize-y rounded-xl border border-edge bg-surface-base px-3 py-2 text-sm leading-6 text-fg outline-none placeholder:text-fg-subtle focus:border-accent focus:ring-2 focus:ring-accent/20"
            />
          </label>

          <div className="grid gap-2 sm:grid-cols-2">
            <NumberField label={labels.nlBuilderMaxPhases} value={constraints.maxPhases ?? 4} min={1} max={8} onChange={(value) => setConstraints((current) => ({ ...current, maxPhases: value }))} />
            <NumberField label={labels.nlBuilderMaxAgents} value={constraints.maxSubagents ?? 8} min={1} max={20} onChange={(value) => setConstraints((current) => ({ ...current, maxSubagents: value }))} />
          </div>

          <div className="grid gap-2 sm:grid-cols-2">
            <label className="flex items-center gap-2 rounded-xl border border-edge bg-surface-base px-3 py-2 text-sm text-fg-muted">
              <input
                type="checkbox"
                checked={Boolean(constraints.allowNetwork)}
                onChange={(event) => setConstraints((value) => ({ ...value, allowNetwork: event.target.checked }))}
              />
              {labels.nlBuilderAllowNetwork}
            </label>
            <label className="block">
              <span className="text-xs font-medium text-fg">{labels.nlBuilderFilesystem}</span>
              <Select
                value={constraints.fileSystem ?? 'read'}
                onChange={(event) => setConstraints((value) => ({ ...value, fileSystem: event.target.value as WorkflowDraftConstraints['fileSystem'] }))}
                className="mt-1.5 w-full rounded-xl border border-edge bg-surface-base px-3 py-2 text-sm text-fg outline-none focus:border-accent focus:ring-2 focus:ring-accent/20"
              >
                <SelectOption value="none">none</SelectOption>
                <SelectOption value="read">read</SelectOption>
                <SelectOption value="write">write</SelectOption>
              </Select>
            </label>
          </div>

          <div className="flex flex-wrap gap-2">
            <Button variant="primary" disabled={!canGenerate} onClick={() => void generate(primaryGenerateMode)}>
              <Sparkles className="size-4" aria-hidden />
              {generating ? labels.nlBuilderGenerating : hasExistingScript ? labels.nlBuilderRewriteExisting : labels.nlBuilderGenerate}
            </Button>
          </div>

          {error ? <Notice text={error} /> : null}
          {draft ? <DraftSummary draft={draft} labels={labels} /> : null}
        </section>

        <section className="min-w-0 space-y-3">
          <WorkflowEditorContextNotice initialDraft={initialDraft} labels={labels} />
          <WorkflowNameField labels={labels} name={name} setName={setName} />
          <WorkflowScriptField labels={labels} script={script} setScript={setScript} minHeightClass="min-h-96" />
          {draft ? <AiValidationPanel draft={draft} labels={labels} validationIssues={validationIssues} /> : null}
        </section>
      </div>

      <div className="flex flex-wrap justify-end gap-2 border-t border-edge px-5 py-4">
        <Button variant="secondary" onClick={onClose} disabled={saving || generating}>
          {labels.cancelDialog}
        </Button>
        <Button variant="secondary" disabled={!canSave} onClick={() => void saveOnly()}>
          {saving ? labels.savingWorkflow : labels.saveWorkflow}
        </Button>
        <Button variant="primary" disabled={!canSave} onClick={() => void saveAndStart()}>
          {labels.nlBuilderSaveAndStart}
        </Button>
      </div>
    </>
  );
}

function ManualCreatePane({
  language,
  saving,
  initialDraft,
  name,
  setName,
  script,
  setScript,
  onClose,
  onSave,
}: {
  language: StoredLanguage;
  saving: boolean;
  initialDraft?: WorkflowEditorInitialDraft | null;
  name: string;
  setName: (value: string) => void;
  script: string;
  setScript: (value: string) => void;
  onClose: () => void;
  onSave: (payload: { name: string; script: string }) => Promise<WorkflowDefinition | void> | WorkflowDefinition | void;
}) {
  const labels = messages(language).workflows;
  const [submitted, setSubmitted] = useState(false);
  const [validating, setValidating] = useState(false);
  const [validationError, setValidationError] = useState<string | null>(null);
  const [validationResult, setValidationResult] = useState<ValidateWorkflowDefinitionResponse | null>(null);

  const trimmedName = name.trim();
  const hasRequiredFields = Boolean(trimmedName && script.trim());

  useEffect(() => {
    if (!hasRequiredFields) {
      setValidating(false);
      setValidationError(null);
      setValidationResult(null);
      return;
    }

    let cancelled = false;
    const timeoutId = window.setTimeout(() => {
      setValidating(true);
      setValidationError(null);
      void validateWorkflowDefinition(trimmedName, script)
        .then((result) => {
          if (cancelled) return;
          setValidationResult(result);
        })
        .catch((err) => {
          if (cancelled) return;
          setValidationResult(null);
          setValidationError(err instanceof Error ? err.message : labels.validateWorkflowFailed);
        })
        .finally(() => {
          if (!cancelled) setValidating(false);
        });
    }, 450);

    return () => {
      cancelled = true;
      window.clearTimeout(timeoutId);
    };
  }, [hasRequiredFields, labels.validateWorkflowFailed, script, trimmedName]);

  const validationIssues = useMemo(() => {
    if (validationError) return [validationError];
    return validationResult?.errors.map((issue) => issue.message) ?? [];
  }, [validationError, validationResult]);

  const showValidationPanel = submitted || validating || validationResult != null || validationError != null;
  const canSave = hasRequiredFields && !saving && !validating && validationResult?.valid === true;

  useEffect(() => {
    if (!initialDraft && !script.trim()) {
      setScript(DEFAULT_SCRIPT);
    }
    setSubmitted(false);
    setValidating(false);
    setValidationError(null);
    setValidationResult(null);
  }, [initialDraft, script, setScript]);

  const submit = async () => {
    setSubmitted(true);
    if (!hasRequiredFields || saving) return;

    setValidating(true);
    setValidationError(null);
    try {
      const result = await validateWorkflowDefinition(trimmedName, script);
      setValidationResult(result);
      if (!result.valid) return;
      const saved = await onSave({ name: trimmedName, script });
      if (saved) onClose();
    } catch (err) {
      setValidationResult(null);
      setValidationError(err instanceof Error ? err.message : labels.validateWorkflowFailed);
    } finally {
      setValidating(false);
    }
  };

  return (
    <>
      <div className="min-h-0 flex-1 space-y-3 overflow-auto px-5 py-4">
        <WorkflowEditorContextNotice initialDraft={initialDraft} labels={labels} />
        <WorkflowNameField
          labels={labels}
          name={name}
          setName={(value) => {
            setName(value);
            setValidationResult(null);
            setValidationError(null);
          }}
        />
        <WorkflowScriptField
          labels={labels}
          script={script}
          setScript={(value) => {
            setScript(value);
            setValidationResult(null);
            setValidationError(null);
          }}
          minHeightClass="min-h-72"
        />
        {showValidationPanel ? (
          <ManualValidationPanel
            labels={labels}
            validating={validating}
            validationIssues={validationIssues}
            validationResult={validationResult}
          />
        ) : null}
      </div>

      <div className="flex justify-end gap-2 border-t border-edge px-5 py-4">
        <Button variant="secondary" onClick={onClose} disabled={saving}>
          {labels.cancelDialog}
        </Button>
        <Button variant="primary" disabled={!canSave} onClick={() => void submit()}>
          {saving ? labels.savingWorkflow : labels.saveWorkflow}
        </Button>
      </div>
    </>
  );
}

function NumberField({
  label,
  value,
  min,
  max,
  onChange,
}: {
  label: string;
  value: number;
  min: number;
  max: number;
  onChange: (value: number | undefined) => void;
}) {
  return (
    <label className="block">
      <span className="text-xs font-medium text-fg">{label}</span>
      <input
        type="number"
        min={min}
        max={max}
        value={value}
        onChange={(event) => onChange(Number(event.target.value) || undefined)}
        className="mt-1.5 w-full rounded-xl border border-edge bg-surface-base px-3 py-2 text-sm text-fg outline-none focus:border-accent focus:ring-2 focus:ring-accent/20"
      />
    </label>
  );
}

function WorkflowNameField({
  labels,
  name,
  setName,
}: {
  labels: WorkflowsMessages;
  name: string;
  setName: (value: string) => void;
}) {
  return (
    <label className="block">
      <span className="text-xs font-medium text-fg">{labels.workflowNameLabel}</span>
      <input
        value={name}
        onChange={(event) => setName(event.target.value)}
        placeholder={labels.workflowNamePlaceholder}
        className="mt-1.5 w-full rounded-xl border border-edge bg-surface-base px-3 py-2 font-mono text-sm text-fg outline-none placeholder:text-fg-subtle focus:border-accent focus:ring-2 focus:ring-accent/20"
      />
    </label>
  );
}

function WorkflowEditorContextNotice({
  initialDraft,
  labels,
}: {
  initialDraft?: WorkflowEditorInitialDraft | null;
  labels: WorkflowsMessages;
}) {
  if (!initialDraft) return null;
  const text =
    initialDraft.mode === 'copy'
      ? labels.copyWorkflowNotice.replace('{{title}}', initialDraft.sourceTitle)
      : labels.editWorkflowNotice.replace('{{title}}', initialDraft.sourceTitle);
  return (
    <div className="rounded-xl border border-accent/20 bg-accent-soft/60 px-3 py-2 text-sm leading-6 text-accent-fg">
      {text}
    </div>
  );
}

function WorkflowScriptField({
  labels,
  script,
  setScript,
  minHeightClass,
}: {
  labels: WorkflowsMessages;
  script: string;
  setScript: (value: string) => void;
  minHeightClass: string;
}) {
  return (
    <label className="block">
      <span className="text-xs font-medium text-fg">{labels.workflowScriptLabel}</span>
      <textarea
        value={script}
        onChange={(event) => setScript(event.target.value)}
        spellCheck={false}
        className={`mt-1.5 w-full resize-y rounded-xl border border-edge bg-surface-base px-3 py-2 font-mono text-xs leading-5 text-fg outline-none focus:border-accent focus:ring-2 focus:ring-accent/20 ${minHeightClass}`}
      />
    </label>
  );
}

function DraftSummary({ draft, labels }: { draft: WorkflowDraftResponse; labels: WorkflowsMessages }) {
  return (
    <div className="space-y-2 rounded-xl border border-edge bg-surface-base/50 p-3">
      <div className="text-sm font-semibold text-fg">{draft.manifest.title ?? draft.name}</div>
      <p className="text-xs leading-5 text-fg-muted">{draft.explanation}</p>
      {draft.repairAttempts > 0 ? (
        <div className="text-xs font-medium text-accent-fg">{labels.nlBuilderAutoRepaired.replace('{count}', String(draft.repairAttempts))}</div>
      ) : null}
      <ChipList title={labels.nlBuilderPermissions} items={draft.permissionsSummary} />
      <ChipList title={labels.nlBuilderAssumptions} items={draft.assumptions} />
      <ChipList title={labels.nlBuilderRisks} items={draft.risks} />
    </div>
  );
}

function AiValidationPanel({
  draft,
  labels,
  validationIssues,
}: {
  draft: WorkflowDraftResponse;
  labels: WorkflowsMessages;
  validationIssues: string[];
}) {
  const lint = draft.lint;
  const ok = draft.validation.valid && lint.every((issue) => issue.severity !== 'error');
  return (
    <div className={ok ? 'rounded-xl border border-emerald-500/30 bg-emerald-500/10 p-3 text-sm text-emerald-800 dark:text-emerald-200' : 'rounded-xl border border-amber-500/30 bg-amber-500/10 p-3 text-sm text-amber-800 dark:text-amber-200'}>
      <div className="flex items-center gap-2 font-medium">
        {ok ? <CheckCircle2 className="size-4" aria-hidden /> : <AlertTriangle className="size-4" aria-hidden />}
        {ok ? labels.validationPassed : labels.nlBuilderReviewIssues}
      </div>
      {validationIssues.length > 0 || lint.length > 0 ? (
        <ul className="mt-2 list-disc space-y-1 pl-5 text-xs leading-5">
          {validationIssues.map((issue) => <li key={issue}>{issue}</li>)}
          {lint.map((issue) => <li key={`${issue.code}:${issue.message}`}>{issue.message}</li>)}
        </ul>
      ) : (
        <p className="mt-1 text-xs opacity-80">{labels.validationPreview.replace('{{phaseCount}}', String(draft.validation.definition?.phases.length ?? 0))}</p>
      )}
    </div>
  );
}

function ManualValidationPanel({
  labels,
  validating,
  validationIssues,
  validationResult,
}: {
  labels: WorkflowsMessages;
  validating: boolean;
  validationIssues: string[];
  validationResult: ValidateWorkflowDefinitionResponse | null;
}) {
  return (
    <div
      className={
        validationIssues.length > 0
          ? 'rounded-xl border border-red-500/30 bg-red-500/10 px-3 py-2 text-sm text-red-700 dark:text-red-200'
          : 'rounded-xl border border-emerald-500/30 bg-emerald-500/10 px-3 py-2 text-sm text-emerald-700 dark:text-emerald-200'
      }
      role="status"
    >
      <div className="font-medium">
        {validating
          ? labels.validatingWorkflow
          : validationIssues.length > 0
            ? labels.validationFailed
            : labels.validationPassed}
      </div>
      {validationIssues.length > 0 ? (
        <ul className="mt-1 list-disc space-y-1 pl-5">
          {validationIssues.map((issue) => (
            <li key={issue}>{issue}</li>
          ))}
        </ul>
      ) : validationResult?.definition ? (
        <div className="mt-1 text-xs opacity-80">
          {labels.validationPreview.replace('{{phaseCount}}', String(validationResult.definition.phases.length))}
        </div>
      ) : null}
    </div>
  );
}

function ChipList({ title, items }: { title: string; items: string[] }) {
  if (!items.length) return null;
  return (
    <div>
      <div className="mb-1 flex items-center gap-1 text-[10px] font-semibold uppercase tracking-wide text-fg-subtle">
        <Braces className="size-3" aria-hidden />
        {title}
      </div>
      <div className="flex flex-wrap gap-1">
        {items.slice(0, 5).map((item) => (
          <span key={item} className="rounded-lg border border-edge-subtle bg-surface-panel px-2 py-1 text-[11px] text-fg-muted">
            {item}
          </span>
        ))}
      </div>
    </div>
  );
}

function Notice({ text }: { text: string }) {
  return (
    <div className="rounded-xl border border-red-500/30 bg-red-500/10 px-3 py-2 text-sm text-red-700 dark:text-red-200">
      {text}
    </div>
  );
}
