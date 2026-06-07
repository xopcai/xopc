import * as Dialog from '@radix-ui/react-dialog';
import { useEffect, useMemo, useState } from 'react';

import { Button } from '@/components/ui/button';
import { messages } from '@/i18n/messages';
import type { StoredLanguage } from '@/lib/storage';

import {
  validateWorkflowDefinition,
  type ValidateWorkflowDefinitionResponse,
} from './workflow-api';

export function WorkflowManageDialog({
  open,
  language,
  saving,
  onClose,
  onSave,
}: {
  open: boolean;
  language: StoredLanguage;
  saving: boolean;
  onClose: () => void;
  onSave: (payload: { name: string; script: string }) => Promise<void> | void;
}) {
  const labels = messages(language).workflows;
  const [name, setName] = useState('');
  const [script, setScript] = useState('');
  const [submitted, setSubmitted] = useState(false);
  const [validating, setValidating] = useState(false);
  const [validationError, setValidationError] = useState<string | null>(null);
  const [validationResult, setValidationResult] = useState<ValidateWorkflowDefinitionResponse | null>(null);

  useEffect(() => {
    if (!open) return;
    setName('');
    setSubmitted(false);
    setValidating(false);
    setValidationError(null);
    setValidationResult(null);
    setScript(
      `export const meta = {
  name: 'my_workflow',
  description: 'Describe what this workflow does.',
  whenToUse: 'When the user asks for …',
  examplePrompts: [
    { field: 'goal', text: 'Example goal for this workflow' },
  ],
  i18n: {
    zh: {
      description: '描述此工作流做什么。',
      whenToUse: '当用户需要 … 时使用',
      examplePrompts: [
        { field: 'goal', text: '此工作流的示例目标' },
      ],
    },
  },
  tags: ['custom'],
  estimatedAgents: { min: 2, max: 4 },
  phases: [{ title: 'Step 1' }, { title: 'Synthesize' }],
}

phase('Step 1')
const first = await agent('Do the first step.', { label: 'step 1' })

phase('Synthesize')
return await agent('Summarize:\\n\\n' + first, { label: 'synthesis' })
`,
    );
  }, [open]);

  const trimmedName = name.trim();
  const hasRequiredFields = Boolean(trimmedName && script.trim());

  useEffect(() => {
    if (!open || !hasRequiredFields) {
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
  }, [hasRequiredFields, labels.validateWorkflowFailed, open, script, trimmedName]);

  const validationIssues = useMemo(() => {
    if (validationError) return [validationError];
    return validationResult?.errors.map((issue) => issue.message) ?? [];
  }, [validationError, validationResult]);

  const showValidationPanel = submitted || validating || validationResult != null || validationError != null;
  const canSave = hasRequiredFields && !saving && !validating && validationResult?.valid === true;

  const submit = async () => {
    setSubmitted(true);
    if (!hasRequiredFields || saving) return;

    setValidating(true);
    setValidationError(null);
    try {
      const result = await validateWorkflowDefinition(trimmedName, script);
      setValidationResult(result);
      if (!result.valid) return;
      await onSave({ name: trimmedName, script });
    } catch (err) {
      setValidationResult(null);
      setValidationError(err instanceof Error ? err.message : labels.validateWorkflowFailed);
    } finally {
      setValidating(false);
    }
  };

  return (
    <Dialog.Root open={open} onOpenChange={(next) => !next && onClose()}>
      <Dialog.Portal>
        <Dialog.Overlay className="xopc-dialog-overlay fixed inset-0 z-65 bg-scrim backdrop-blur-[1px]" />
        <Dialog.Content className="fixed left-1/2 top-1/2 z-66 flex max-h-[min(90vh,44rem)] w-[min(100%-2rem,48rem)] -translate-x-1/2 -translate-y-1/2 flex-col overflow-hidden rounded-2xl border border-edge bg-surface-panel shadow-popover outline-none">
          <div className="border-b border-edge px-5 py-4">
            <Dialog.Title className="text-base font-semibold text-fg">{labels.manageDialogTitle}</Dialog.Title>
            <Dialog.Description className="mt-1 text-sm text-fg-muted">{labels.manageDialogHint}</Dialog.Description>
          </div>

          <div className="min-h-0 flex-1 space-y-3 overflow-auto px-5 py-4">
            <label className="block">
              <span className="text-xs font-medium text-fg">{labels.workflowNameLabel}</span>
              <input
                value={name}
                onChange={(event) => {
                  setName(event.target.value);
                  setValidationResult(null);
                  setValidationError(null);
                }}
                placeholder={labels.workflowNamePlaceholder}
                className="mt-1.5 w-full rounded-xl border border-edge bg-surface-base px-3 py-2 text-sm font-mono text-fg outline-none placeholder:text-fg-subtle focus:border-accent focus:ring-2 focus:ring-accent/20"
              />
            </label>
            <label className="block">
              <span className="text-xs font-medium text-fg">{labels.workflowScriptLabel}</span>
              <textarea
                value={script}
                onChange={(event) => {
                  setScript(event.target.value);
                  setValidationResult(null);
                  setValidationError(null);
                }}
                spellCheck={false}
                className="mt-1.5 min-h-72 w-full resize-y rounded-xl border border-edge bg-surface-base px-3 py-2 font-mono text-xs leading-5 text-fg outline-none focus:border-accent focus:ring-2 focus:ring-accent/20"
              />
            </label>

            {showValidationPanel ? (
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
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}
