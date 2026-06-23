import { CheckCircle2, Circle } from 'lucide-react';
import type { ReactNode } from 'react';

import { cn } from '@/lib/cn';

import type { BrowserMessages } from './types';

type ChecklistStep = {
  id: string;
  label: string;
  done: boolean;
  detail?: ReactNode;
};

export function ExtensionSetupGuide({
  m,
  installed,
  extensionDir,
  connected,
  busy,
  onOpenChrome,
  onCopyPath,
  onRevealFolder,
  pathBusy,
  folderBusy,
}: {
  m: BrowserMessages;
  installed: boolean;
  extensionDir: string | undefined;
  connected: boolean;
  busy: boolean;
  onOpenChrome: () => void;
  onCopyPath: () => void;
  onRevealFolder: () => void;
  pathBusy: boolean;
  folderBusy: boolean;
}) {
  const steps: ChecklistStep[] = [
    {
      id: 'install',
      label: m.browserExtensionInstallStep1,
      done: installed,
    },
    {
      id: 'load',
      label: m.browserExtensionInstallStep2,
      done: Boolean(extensionDir) && connected,
      detail: extensionDir ? (
        <div className="mt-2 rounded-md border border-edge bg-surface-raised px-2.5 py-2">
          <p className="text-[10px] font-medium uppercase tracking-wide text-fg-subtle">
            {m.browserExtensionInstallStep2FolderLabel}
          </p>
          <p className="mt-1 break-all font-mono text-[11px] text-fg">{extensionDir}</p>
          <div className="mt-2 flex flex-wrap gap-3">
            <button
              type="button"
              className="inline-flex items-center gap-1 text-[11px] text-accent hover:underline disabled:opacity-60"
              disabled={busy}
              onClick={onOpenChrome}
            >
              {m.browserExtensionOpenChrome}
            </button>
            <button
              type="button"
              className="inline-flex items-center gap-1 text-[11px] text-accent hover:underline disabled:opacity-60"
              disabled={busy}
              onClick={onCopyPath}
              title={extensionDir}
            >
              {pathBusy ? m.browserExtensionInstalling : m.browserExtensionCopyPath}
            </button>
            <button
              type="button"
              className="inline-flex items-center gap-1 text-[11px] text-accent hover:underline disabled:opacity-60"
              disabled={busy}
              onClick={onRevealFolder}
              title={extensionDir}
            >
              {folderBusy ? m.browserExtensionInstalling : m.browserExtensionRevealFolder}
            </button>
          </div>
        </div>
      ) : null,
    },
    {
      id: 'connect',
      label: m.browserExtensionInstallStep3,
      done: connected,
    },
  ];

  const completedCount = steps.filter((s) => s.done).length;

  return (
    <div
      aria-label={m.browserExtensionInstallGuideTitle}
      className="rounded-xl border border-edge bg-surface-base px-3 py-3"
    >
      <div className="mb-3 flex items-center gap-2">
        <h4 className="text-sm font-medium text-fg">{m.browserExtensionInstallGuideTitle}</h4>
        <span className="ml-auto text-xs font-normal text-fg-muted">
          {m.browserExtensionChecklistProgress.replace('{{done}}', String(completedCount)).replace(
            '{{total}}',
            String(steps.length),
          )}
        </span>
      </div>
      <ol className="flex flex-col gap-3">
        {steps.map((step, index) => (
          <li key={step.id} className="flex gap-2.5">
            <span className="mt-0.5 shrink-0" aria-hidden>
              {step.done ? (
                <CheckCircle2 className="size-4 text-emerald-500" strokeWidth={2} />
              ) : (
                <Circle className="size-4 text-fg-subtle" strokeWidth={1.75} />
              )}
            </span>
            <div className="min-w-0 flex-1">
              <p
                className={cn(
                  'text-[11px] leading-relaxed',
                  step.done ? 'text-fg-muted line-through decoration-fg-subtle/60' : 'text-fg',
                )}
              >
                <span className="sr-only">
                  {step.done ? m.browserExtensionChecklistDone : m.browserExtensionChecklistPending}{' '}
                </span>
                {index + 1}. {step.label}
              </p>
              {step.detail}
            </div>
          </li>
        ))}
      </ol>
    </div>
  );
}
