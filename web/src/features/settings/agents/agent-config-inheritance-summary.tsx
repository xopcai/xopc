import { Link2 } from 'lucide-react';
import { Link } from 'react-router-dom';

import { SettingsFormSection, SettingsFormSectionHeader } from '@/features/settings/settings-form-section';
import type { SettingsNavLocationState } from '@/features/settings/settings-nav-state';
import type { AgentsSettingsMessages } from '@/i18n/messages';
import { cn } from '@/lib/cn';

function InheritanceRow({
  label,
  mode,
  value,
  inheritedFrom,
  inheritLabel,
  overrideLabel,
}: {
  label: string;
  mode: 'inherit' | 'override';
  value: string;
  inheritedFrom?: string;
  inheritLabel: string;
  overrideLabel: string;
}) {
  return (
    <div className="flex flex-col gap-1 rounded-xl border border-edge-subtle bg-surface-panel px-4 py-3 sm:flex-row sm:items-center sm:justify-between">
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
    </div>
  );
}

export function AgentConfigInheritanceSummary(props: {
  a: AgentsSettingsMessages;
  defaultModel: string;
  defaultWorkspace: string;
  agentModel: string;
  agentWorkspace: string;
  settingsPath?: string;
  settingsState?: SettingsNavLocationState;
}) {
  const {
    a,
    defaultModel,
    defaultWorkspace,
    agentModel,
    agentWorkspace,
    settingsPath = '/settings/agent-defaults',
    settingsState,
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
        trailing={
          <Link
            to={settingsPath}
            state={settingsState}
            className="text-xs font-medium text-accent hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/40"
          >
            {inh.editDefaultsLink}
          </Link>
        }
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
        />
      </div>
    </SettingsFormSection>
  );
}
