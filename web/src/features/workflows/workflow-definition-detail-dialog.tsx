import * as Dialog from '@radix-ui/react-dialog';
import { Braces, ShieldCheck } from 'lucide-react';

import { Button } from '@/components/ui/button';
import { messages } from '@/i18n/messages';
import type { StoredLanguage } from '@/lib/storage';

import type { JsonSchema, WorkflowDefinition } from './workflow-api';
import { resolveWorkflowLocalizedCopy } from './workflow-meta-locale';

export function WorkflowDefinitionDetailDialog({
  open,
  definition,
  language,
  onClose,
  onRun,
}: {
  open: boolean;
  definition: WorkflowDefinition | null;
  language: StoredLanguage;
  onClose: () => void;
  onRun: () => void;
}) {
  const labels = messages(language).workflows;
  if (!definition) return null;

  const localized = resolveWorkflowLocalizedCopy(definition, language);
  const script = definition.runtime?.source ?? '';

  return (
    <Dialog.Root open={open} onOpenChange={(next) => !next && onClose()}>
      <Dialog.Portal>
        <Dialog.Overlay className="xopc-dialog-overlay fixed inset-0 z-65 bg-scrim backdrop-blur-[1px]" />
        <Dialog.Content className="fixed left-1/2 top-1/2 z-66 flex max-h-[min(85vh,44rem)] w-[min(100%-2rem,48rem)] -translate-x-1/2 -translate-y-1/2 flex-col overflow-hidden rounded-2xl border border-edge bg-surface-panel shadow-popover outline-none">
          <div className="border-b border-edge px-5 py-4">
            <Dialog.Title className="text-base font-semibold text-fg">{definition.title}</Dialog.Title>
            <Dialog.Description className="mt-1 text-sm text-fg-muted">{localized.description}</Dialog.Description>
          </div>

          <div className="min-h-0 flex-1 space-y-4 overflow-auto px-5 py-4">
            {localized.whenToUse ? (
              <section>
                <h3 className="text-xs font-semibold uppercase tracking-wide text-fg-subtle">{labels.whenToUseHeading}</h3>
                <p className="mt-2 text-sm leading-6 text-fg-muted">{localized.whenToUse}</p>
              </section>
            ) : null}

            <DefinitionCapabilities definition={definition} labels={labels} />

            {definition.inputSchema ? (
              <SchemaPreview title={labels.inputsHeading} schema={definition.inputSchema} />
            ) : null}

            {definition.outputSchema ? (
              <SchemaPreview title={labels.outputsHeading} schema={definition.outputSchema} />
            ) : null}

            {definition.phases.length > 0 ? (
              <section>
                <h3 className="text-xs font-semibold uppercase tracking-wide text-fg-subtle">{labels.phasesHeading}</h3>
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

            {script ? (
              <section>
                <h3 className="text-xs font-semibold uppercase tracking-wide text-fg-subtle">{labels.scriptHeading}</h3>
                <pre className="mt-2 max-h-64 overflow-auto rounded-xl border border-edge bg-surface-base/50 p-3 font-mono text-xs leading-5 text-fg-muted">
                  {script}
                </pre>
              </section>
            ) : null}
          </div>

          <div className="flex justify-end gap-2 border-t border-edge px-5 py-4">
            <Button variant="secondary" onClick={onClose}>
              {labels.closeResult}
            </Button>
            <Button variant="primary" onClick={onRun}>
              {labels.runWorkflow}
            </Button>
          </div>
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
