import * as Dialog from '@radix-ui/react-dialog';
import { useEffect, useState } from 'react';

import { Button } from '@/components/ui/button';
import { messages } from '@/i18n/messages';
import type { StoredLanguage } from '@/lib/storage';

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
  onSave: (payload: { name: string; script: string }) => void;
}) {
  const labels = messages(language).workflows;
  const [name, setName] = useState('');
  const [script, setScript] = useState('');

  useEffect(() => {
    if (!open) return;
    setName('');
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
                onChange={(event) => setName(event.target.value)}
                placeholder={labels.workflowNamePlaceholder}
                className="mt-1.5 w-full rounded-xl border border-edge bg-surface-base px-3 py-2 text-sm font-mono text-fg outline-none placeholder:text-fg-subtle focus:border-accent focus:ring-2 focus:ring-accent/20"
              />
            </label>
            <label className="block">
              <span className="text-xs font-medium text-fg">{labels.workflowScriptLabel}</span>
              <textarea
                value={script}
                onChange={(event) => setScript(event.target.value)}
                spellCheck={false}
                className="mt-1.5 min-h-72 w-full resize-y rounded-xl border border-edge bg-surface-base px-3 py-2 font-mono text-xs leading-5 text-fg outline-none focus:border-accent focus:ring-2 focus:ring-accent/20"
              />
            </label>
          </div>

          <div className="flex justify-end gap-2 border-t border-edge px-5 py-4">
            <Button variant="secondary" onClick={onClose} disabled={saving}>
              {labels.cancelDialog}
            </Button>
            <Button
              variant="primary"
              disabled={saving || !name.trim() || !script.trim()}
              onClick={() => onSave({ name: name.trim(), script })}
            >
              {saving ? labels.savingWorkflow : labels.saveWorkflow}
            </Button>
          </div>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}
