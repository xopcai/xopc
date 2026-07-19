import * as Dialog from '@radix-ui/react-dialog';
import { Braces, CopyPlus, Pencil, Play, ShieldCheck, X } from 'lucide-react';

import { Button } from '@/components/ui/button';
import { messages } from '@/i18n/messages';
import type { StoredLanguage } from '@/lib/storage';

import type { JsonSchema, WorkflowDefinition } from './workflow-api';
import { WorkflowDefinitionGraph } from './workflow-definition-graph';
import { resolveWorkflowLocalizedCopy } from './workflow-meta-locale';

export function WorkflowDefinitionDetailDialog({
  open,
  definition,
  language,
  onClose,
  onRun,
  onEdit,
}: {
  open: boolean;
  definition: WorkflowDefinition | null;
  language: StoredLanguage;
  onClose: () => void;
  onRun: () => void;
  onEdit: () => void;
}) {
  const labels = messages(language).workflows;
  if (!definition) return null;

  const localized = resolveWorkflowLocalizedCopy(definition, language);
  const isUser = definition.metadata.source === 'user';
  const copy = language === 'zh'
    ? { map: '工作流怎么完成任务', mapHint: '点击任一步骤查看它负责什么。', version: `版本 ${definition.revision}` }
    : { map: 'How this workflow completes the task', mapHint: 'Select any step to see what it is responsible for.', version: `Version ${definition.revision}` };

  return (
    <Dialog.Root open={open} onOpenChange={(next) => !next && onClose()}>
      <Dialog.Portal>
        <Dialog.Overlay className="xopc-dialog-overlay fixed inset-0 z-65 bg-scrim backdrop-blur-[1px]" />
        <Dialog.Content className="fixed left-1/2 top-1/2 z-66 flex h-[min(92vh,54rem)] w-[min(100%-1.5rem,72rem)] -translate-x-1/2 -translate-y-1/2 flex-col overflow-hidden rounded-2xl border border-edge bg-surface-panel shadow-popover outline-none">
          <header className="flex shrink-0 items-start gap-4 border-b border-edge px-5 py-4">
            <div className="min-w-0 flex-1">
              <div className="mb-2 flex flex-wrap items-center gap-2">
                <span className={isUser ? 'rounded-full bg-accent-soft px-2 py-0.5 text-[11px] font-medium text-accent-fg' : 'rounded-full bg-surface-hover px-2 py-0.5 text-[11px] font-medium text-fg-muted'}>
                  {isUser ? labels.badgeUser : labels.badgeBuiltin}
                </span>
                <span className="text-xs text-fg-subtle">{copy.version}</span>
              </div>
              <Dialog.Title className="text-lg font-semibold text-fg">{definition.title}</Dialog.Title>
              <Dialog.Description className="mt-1 max-w-3xl text-sm leading-6 text-fg-muted">{localized.description}</Dialog.Description>
            </div>
            <Dialog.Close asChild>
              <Button variant="ghost" className="size-9 shrink-0 p-0" aria-label={labels.closeResult}>
                <X className="size-4" aria-hidden />
              </Button>
            </Dialog.Close>
          </header>

          <div className="min-h-0 flex-1 overflow-y-auto">
            <section className="border-b border-edge bg-surface-base/35 px-5 py-4">
              <div className="mb-3">
                <h2 className="text-sm font-semibold text-fg">{copy.map}</h2>
                <p className="mt-1 text-xs text-fg-muted">{copy.mapHint}</p>
              </div>
              <WorkflowDefinitionGraph key={definition.id} graph={definition.graph} language={language} className="rounded-xl border border-edge" />
            </section>

            <div className="space-y-4 px-5 py-4">
            {localized.whenToUse ? (
              <section>
                <h3 className="text-xs font-semibold uppercase tracking-wide text-fg-subtle">{labels.templateBestFor}</h3>
                <p className="mt-2 text-sm leading-6 text-fg-muted">{localized.whenToUse}</p>
              </section>
            ) : null}

            {localized.examplePrompts?.length ? (
              <section>
                <h3 className="text-xs font-semibold uppercase tracking-wide text-fg-subtle">{labels.templateExample}</h3>
                <div className="mt-2 grid gap-2">
                  {localized.examplePrompts.slice(0, 3).map((example) => (
                    <div key={`${example.field}:${example.text}`} className="rounded-xl border border-edge bg-surface-base/40 px-3 py-2 text-sm text-fg-muted">
                      {example.text}
                    </div>
                  ))}
                </div>
              </section>
            ) : null}

            <section className="grid gap-2 sm:grid-cols-2">
              <div className="rounded-xl border border-edge bg-surface-base/40 px-3 py-2">
                <h3 className="text-xs font-semibold uppercase tracking-wide text-fg-subtle">{labels.templateInputs}</h3>
                <p className="mt-1 text-sm text-fg-muted">
                  {definition.inputSchema ? labels.templateInputsStructured : labels.templateInputsGoalOnly}
                </p>
              </div>
              <div className="rounded-xl border border-edge bg-surface-base/40 px-3 py-2">
                <h3 className="text-xs font-semibold uppercase tracking-wide text-fg-subtle">{labels.templateExpectedOutput}</h3>
                <p className="mt-1 text-sm text-fg-muted">{labels.templateOutputReport}</p>
              </div>
            </section>

            {definition.phases.length > 0 ? (
              <section>
                <h3 className="text-xs font-semibold uppercase tracking-wide text-fg-subtle">{labels.templatePlan}</h3>
                <ol className="mt-2 space-y-2">
                  {definition.phases.map((phase, index) => (
                    <li key={phase.id} className="rounded-xl border border-edge bg-surface-base/40 px-3 py-2">
                      <div className="text-sm font-medium text-fg">
                        {index + 1}. {phase.title}
                      </div>
                      {phase.description ? (
                        <p className="mt-1 text-xs leading-5 text-fg-muted">{phase.description}</p>
                      ) : null}
                    </li>
                  ))}
                </ol>
              </section>
            ) : null}

            <details className="rounded-xl border border-edge bg-surface-base/35">
              <summary className="cursor-pointer px-3 py-2 text-sm font-medium text-fg">
                {labels.advancedTemplateDetails}
              </summary>
              <div className="space-y-4 border-t border-edge px-3 py-3">
                <DefinitionCapabilities definition={definition} labels={labels} />

                {definition.inputSchema ? (
                  <SchemaPreview title={labels.inputsHeading} schema={definition.inputSchema} />
                ) : null}

                {definition.outputSchema ? (
                  <SchemaPreview title={labels.outputsHeading} schema={definition.outputSchema} />
                ) : null}

              </div>
            </details>
            </div>
          </div>

          <footer className="flex shrink-0 flex-wrap items-center justify-end gap-2 border-t border-edge px-5 py-4">
            <Button variant="secondary" onClick={onClose}>
              {labels.closeResult}
            </Button>
            <Button variant="secondary" onClick={onEdit}>
              {isUser ? <Pencil className="size-4" aria-hidden /> : <CopyPlus className="size-4" aria-hidden />}
              {isUser ? labels.editWorkflow : labels.copyAndEditWorkflow}
            </Button>
            <Button variant="primary" onClick={onRun}>
              <Play className="size-4" aria-hidden />
              {labels.runWorkflow}
            </Button>
          </footer>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}

function DefinitionCapabilities({
  definition,
  labels,
}: {
  definition: WorkflowDefinition;
  labels: ReturnType<typeof messages>['workflows'];
}) {
  const permissions = definition.permissions;
  const resources = definition.resources;
  const rows = [
    permissions?.tools?.length ? [labels.permissionsTools, permissions.tools.join(', ')] : null,
    permissions?.network != null ? [labels.permissionsNetwork, permissions.network ? labels.networkEnabled : labels.networkDisabled] : null,
    permissions?.fileSystem ? [labels.permissionsFileSystem, permissions.fileSystem] : null,
    permissions?.approvalRequired ? [labels.permissionsApproval, labels.permissionsApproval] : null,
    resources?.skills?.length ? [labels.resourcesSkills, resources.skills.join(', ')] : null,
    resources?.contextFiles?.length ? [labels.resourcesContextFiles, resources.contextFiles.join(', ')] : null,
    resources?.promptTemplates?.length ? [labels.resourcesPromptTemplates, resources.promptTemplates.join(', ')] : null,
  ].filter(Boolean) as Array<[string, string]>;

  return (
    <section>
      <h3 className="text-xs font-semibold uppercase tracking-wide text-fg-subtle">{labels.capabilitiesHeading}</h3>
      {rows.length > 0 ? (
        <div className="mt-2 grid gap-2 sm:grid-cols-2">
          {rows.map(([label, value]) => (
            <div key={`${label}:${value}`} className="rounded-xl border border-edge bg-surface-base/40 px-3 py-2">
              <div className="flex items-center gap-2 text-xs font-medium text-fg-muted">
                <ShieldCheck className="size-3.5 text-fg-subtle" aria-hidden />
                {label}
              </div>
              <div className="mt-1 break-words text-sm text-fg">{value}</div>
            </div>
          ))}
        </div>
      ) : (
        <p className="mt-2 text-sm text-fg-muted">{labels.capabilityNone}</p>
      )}
    </section>
  );
}

function SchemaPreview({ title, schema }: { title: string; schema: JsonSchema }) {
  const propertyNames = Object.keys(schema.properties ?? {});
  return (
    <section>
      <h3 className="flex items-center gap-2 text-xs font-semibold uppercase tracking-wide text-fg-subtle">
        <Braces className="size-3.5" aria-hidden />
        {title}
      </h3>
      {propertyNames.length > 0 ? (
        <div className="mt-2 flex flex-wrap gap-1.5">
          {propertyNames.map((name) => (
            <span key={name} className="rounded-lg border border-edge-subtle bg-surface-base px-2 py-1 text-xs text-fg-muted">
              {name}
            </span>
          ))}
        </div>
      ) : null}
      <details className="mt-2">
        <summary className="cursor-pointer text-xs text-fg-subtle hover:text-fg-muted">JSON</summary>
        <pre className="mt-2 max-h-48 overflow-auto rounded-xl border border-edge bg-surface-base/50 p-3 font-mono text-xs leading-5 text-fg-muted">
          {JSON.stringify(schema, null, 2)}
        </pre>
      </details>
    </section>
  );
}
