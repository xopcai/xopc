import { Bot, Brain, Cable, MessageSquarePlus, Sparkles, Wrench } from 'lucide-react';

import { Button } from '@/components/ui/button';
import type { GatewayAgentRow } from '@/features/settings/agents-admin-api';
import { AgentAvatarDisplay } from '@/features/settings/agents/agent-avatar-display';
import {
  agentListDisplayDescription,
  agentListDisplayName,
} from '@/features/settings/agents/agent-display-names';
import { SettingsFormSection, SettingsFormSectionHeader } from '@/features/settings/settings-form-section';
import type { AgentsSettingsMessages } from '@/i18n/messages';

function FieldCard({
  label,
  value,
  badge,
  mono,
}: {
  label: string;
  value: string;
  badge: string;
  mono?: boolean;
}) {
  return (
    <div className="rounded-xl bg-surface-panel/80 px-4 py-3 shadow-surface">
      <div className="flex items-center justify-between gap-3">
        <p className="text-xs font-medium uppercase tracking-wide text-fg-subtle">{label}</p>
        <span className="shrink-0 rounded-full bg-surface-hover px-2 py-0.5 text-xs font-medium text-fg-muted">
          {badge}
        </span>
      </div>
      <p className={mono ? 'mt-2 truncate font-mono text-xs text-fg' : 'mt-2 truncate text-sm font-medium text-fg'}>
        {value}
      </p>
    </div>
  );
}

function CapabilityCard({
  icon: Icon,
  label,
  value,
}: {
  icon: typeof Wrench;
  label: string;
  value: string;
}) {
  return (
    <div className="flex items-center gap-3 rounded-xl bg-surface-panel/80 px-4 py-3 shadow-surface">
      <div className="flex size-9 shrink-0 items-center justify-center rounded-lg bg-surface-hover text-fg-muted">
        <Icon className="size-4" strokeWidth={1.8} aria-hidden />
      </div>
      <div className="min-w-0">
        <p className="text-xs font-medium uppercase tracking-wide text-fg-subtle">{label}</p>
        <p className="mt-1 truncate text-sm font-medium text-fg">{value}</p>
      </div>
    </div>
  );
}

export function AgentOverviewSummaryTab({
  a,
  selected,
  defaultModel,
  defaultWorkspace,
  isTuiDefault,
  isTuiDefaultInherited,
  busy,
  onSetDefault,
  onSetTuiDefault,
  onTryInChat,
}: {
  a: AgentsSettingsMessages;
  selected: GatewayAgentRow;
  defaultModel: string;
  defaultWorkspace: string;
  isTuiDefault: boolean;
  isTuiDefaultInherited: boolean;
  busy: boolean;
  onSetDefault: () => void;
  onSetTuiDefault: () => void;
  onTryInChat?: () => void;
}) {
  const title = agentListDisplayName(selected, a);
  const description = agentListDisplayDescription(selected, a) || a.listNoDescription;
  const modelValue = selected.model?.primary?.trim() || defaultModel || a.listUnsetValue;
  const workspaceValue = selected.workspace?.trim() || defaultWorkspace || a.listUnsetValue;
  const modelBadge = selected.model?.primary?.trim() ? a.inheritance.badgeOverride : a.inheritance.badgeInherit;
  const workspaceBadge =
    selected.workspace?.trim() && selected.workspace.trim() !== defaultWorkspace.trim()
      ? a.inheritance.badgeOverride
      : a.inheritance.badgeInherit;
  const disabledTools = selected.tools.effectiveDisable.length;
  const skillsCount = selected.skills.effectiveAllowlist?.length;

  return (
    <div className="flex min-h-0 flex-1 flex-col gap-5 overflow-y-auto">
      <SettingsFormSection>
        <div className="flex flex-col gap-4">
          <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
            <div className="flex min-w-0 items-start gap-4">
              <div className="flex size-14 shrink-0 items-center justify-center overflow-hidden rounded-2xl bg-surface-base ring-1 ring-edge-subtle/50">
                <AgentAvatarDisplay agentId={selected.id} avatar={selected.avatar} size={56} className="size-full" />
              </div>
              <div className="min-w-0">
                <div className="flex min-w-0 flex-wrap items-center gap-2">
                  <h2 className="truncate text-lg font-semibold text-fg">{title}</h2>
                  {selected.isDefault ? (
                    <span className="rounded-full bg-accent-soft px-2 py-0.5 text-xs font-medium text-accent">
                      {a.globalDefaultBadge}
                    </span>
                  ) : null}
                  {isTuiDefault ? (
                    <span className="rounded-full bg-surface-hover px-2 py-0.5 text-xs font-medium text-fg">
                      {isTuiDefaultInherited ? a.tuiDefaultInheritedBadge : a.tuiDefaultBadge}
                    </span>
                  ) : null}
                </div>
                <p className="mt-1 truncate font-mono text-xs text-fg-muted">{selected.id}</p>
              </div>
            </div>
            <div className="flex shrink-0 flex-wrap gap-2">
              {onTryInChat ? (
                <Button type="button" disabled={busy} onClick={onTryInChat}>
                  <MessageSquarePlus className="size-4" aria-hidden />
                  {a.tryInChat}
                </Button>
              ) : null}
              {!selected.isDefault ? (
                <Button type="button" variant="secondary" disabled={busy} onClick={onSetDefault}>
                  {a.setDefault}
                </Button>
              ) : null}
              {!isTuiDefault ? (
                <Button type="button" variant="secondary" disabled={busy} onClick={onSetTuiDefault}>
                  {a.setTuiDefault}
                </Button>
              ) : null}
            </div>
          </div>
          <p className="w-full text-sm leading-6 text-fg-muted">{description}</p>
        </div>
      </SettingsFormSection>

      <SettingsFormSection>
        <SettingsFormSectionHeader icon={Sparkles} title={a.overviewRuntimeTitle} subtitle={a.overviewRuntimeHint} />
        <div className="grid gap-3 sm:grid-cols-2">
          <FieldCard label={a.modelPrimary} value={modelValue} badge={modelBadge} mono />
          <FieldCard label={a.workspacePath} value={workspaceValue} badge={workspaceBadge} mono />
        </div>
      </SettingsFormSection>

      <SettingsFormSection>
        <SettingsFormSectionHeader icon={Bot} title={a.overviewCapabilitiesTitle} subtitle={a.overviewCapabilitiesHint} />
        <div className="grid gap-3 sm:grid-cols-2">
          <CapabilityCard
            icon={Wrench}
            label={a.listToolsLabel}
            value={disabledTools > 0 ? a.listToolsDisabledCount.replace('{{count}}', String(disabledTools)) : a.listToolsAllEnabled}
          />
          <CapabilityCard
            icon={Sparkles}
            label={a.listSkillsLabel}
            value={skillsCount ? a.listSkillsCount.replace('{{count}}', String(skillsCount)) : a.listInheritedValue}
          />
          <CapabilityCard icon={Cable} label={a.connectionsTitle} value={a.overviewConnectionsManaged} />
          <CapabilityCard icon={Brain} label={a.overviewSharedMemoryLabel} value={a.overviewSharedMemoryValue} />
        </div>
      </SettingsFormSection>
    </div>
  );
}
