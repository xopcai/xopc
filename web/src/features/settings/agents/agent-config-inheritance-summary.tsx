import { Link2 } from 'lucide-react';

import { SettingsFormSection, SettingsFormSectionHeader } from '@/features/settings/settings-form-section';
import type { AgentsSettingsMessages } from '@/i18n/messages';
import { cn } from '@/lib/cn';

function InheritanceRow({
  label,
  mode,
  value,
  inheritedFrom,
  inheritLabel,
  overrideLabel,
  onClick,
}: {
  label: string;
  mode: 'inherit' | 'override';
  value: string;
  inheritedFrom?: string;
  inheritLabel: string;
  overrideLabel: string;
  onClick?: () => void;
}) {
  const content = (
    <>
      <div className="min-w-0">
        <p className="text-xs font-medium uppercase tracking-wide text-fg-subtle">{label}</p>
        <p className="mt-1 truncate text-sm font-medium text-fg">{value || '—'}</p>
        {mode === 'inherit' && inheritedFrom ? (
          <p className="mt-0.5 truncate text-xs text-fg-muted">{inheritedFrom}</p>
        ) : null}
      </div>
      <span
        className={cn(
          'mt-2 inline-flex shrink-0 self-start rounded-full px-2.5 py-0.5 text-xs font-medium sm:mt-0',
          mode === 'inherit'
            ? 'bg-surface-hover text-fg-muted'
            : 'bg-accent-soft text-accent-fg',
        )}
      >
        {mode === 'inherit' ? inheritLabel : overrideLabel}
      </span>
    </>
  );

  const className = cn(
    'flex flex-col gap-1 rounded-xl border border-edge-subtle bg-surface-panel px-4 py-3 sm:flex-row sm:items-center sm:justify-between',
    onClick
      ? 'w-full text-left transition-colors hover:border-edge hover:bg-surface-hover/45 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/40 active:scale-[0.995] motion-reduce:active:scale-100'
      : undefined,
  );

  if (onClick) {
    return (
      <button type="button" className={className} onClick={onClick}>
        {content}
      </button>
    );
  }

  return (
    <div className={className}>{content}</div>
  );
}

export function AgentConfigInheritanceSummary(props: {
  a: AgentsSettingsMessages;
  defaultModel: string;
  defaultWorkspace: string;
  agentModel: string;
  agentWorkspace: string;
  onEditModelStrategy?: () => void;
  onEditWorkspace?: () => void;
}) {
  const {
    a,
    defaultModel,
    defaultWorkspace,
    agentModel,
    agentWorkspace,
    onEditModelStrategy,
    onEditWorkspace,
  } = props;
  const inh = a.inheritance;

  const modelInherits = !agentModel.trim();
  const workspaceInherits =
    !agentWorkspace.trim() ||
    (defaultWorkspace.trim().length > 0 && agentWorkspace.trim() === defaultWorkspace.trim());

  const displayModel = modelInherits ? defaultModel || inh.unset : agentModel;
  const displayWorkspace = workspaceInherits ? defaultWorkspace || inh.unset : agentWorkspace;

  return (
    <SettingsFormSection>
      <SettingsFormSectionHeader
        icon={Link2}
        title={inh.title}
        subtitle={inh.subtitle}
      />
      <div className="mt-4 grid gap-3 sm:grid-cols-2">
        <InheritanceRow
          label={inh.modelLabel}
          mode={modelInherits ? 'inherit' : 'override'}
          value={displayModel}
          inheritedFrom={
            modelInherits && defaultModel
              ? inh.inheritsValue.replace('{{value}}', defaultModel)
              : undefined
          }
          inheritLabel={inh.badgeInherit}
          overrideLabel={inh.badgeOverride}
          onClick={onEditModelStrategy}
        />
        <InheritanceRow
          label={inh.workspaceLabel}
          mode={workspaceInherits ? 'inherit' : 'override'}
          value={displayWorkspace}
          inheritedFrom={
            workspaceInherits && defaultWorkspace
              ? inh.inheritsValue.replace('{{value}}', defaultWorkspace)
              : undefined
          }
          inheritLabel={inh.badgeInherit}
          overrideLabel={inh.badgeOverride}
          onClick={onEditWorkspace}
        />
      </div>
    </SettingsFormSection>
  );
}
