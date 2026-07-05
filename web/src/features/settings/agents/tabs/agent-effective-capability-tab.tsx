import { ListChecks } from 'lucide-react';
import useSWR from 'swr';

import {
  fetchGatewayAgentEffectiveManifest,
  type GatewayAgentEffectiveManifestPayload,
  type GatewayAgentRow,
} from '@/features/settings/agents-admin-api';
import { SettingsFormSection, SettingsFormSectionHeader } from '@/features/settings/settings-form-section';
import type { AgentsSettingsMessages } from '@/i18n/messages';
import { cn } from '@/lib/cn';

function sourceFor(sources: Record<string, string>, paths: string[]): string {
  for (const path of paths) {
    const source = sources[path];
    if (source) return source;
  }
  return 'default';
}

function SourceBadge({ source }: { source: string }) {
  const preset = source.startsWith('preset:');
  const agent = source.startsWith('agent:');
  return (
    <span
      className={cn(
        'shrink-0 rounded-full border px-2 py-0.5 text-[11px] font-medium',
        preset && 'border-accent/25 bg-accent/10 text-accent',
        agent && 'border-edge bg-surface-base text-fg-muted',
        !preset && !agent && 'border-edge-subtle bg-surface-panel text-fg-subtle',
      )}
    >
      {source}
    </span>
  );
}

function PolicyRow(props: { name: string; value: string; source: string; monoValue?: boolean }) {
  return (
    <div className="grid gap-2 rounded-lg border border-edge-subtle bg-surface-panel px-3 py-2 sm:grid-cols-[minmax(0,10rem)_minmax(0,1fr)_auto] sm:items-center">
      <div className="min-w-0 truncate font-mono text-xs font-medium text-fg">{props.name}</div>
      <div className={cn('min-w-0 truncate text-sm text-fg', props.monoValue && 'font-mono text-xs')}>
        {props.value}
      </div>
      <SourceBadge source={props.source} />
    </div>
  );
}

function listValue(items: string[] | undefined, fallback: string): string {
  return items && items.length > 0 ? items.join(', ') : fallback;
}

export function AgentEffectiveCapabilityTab(props: {
  a: AgentsSettingsMessages;
  selected: GatewayAgentRow;
}) {
  const { a, selected } = props;
  const { data, error, isLoading } = useSWR<GatewayAgentEffectiveManifestPayload>(
    selected.id ? ['agent-effective-manifest', selected.id] : null,
    () => fetchGatewayAgentEffectiveManifest(selected.id),
    { revalidateOnFocus: false },
  );

  const manifest = data?.manifest;
  const presetChain = data?.presetChain ?? manifest?.extends ?? [];
  const sources = data?.sources ?? {};
  const modelRoles = Object.entries(manifest?.models?.roles ?? {}).sort(([aId], [bId]) => aId.localeCompare(bId));
  const toolPolicies = Object.entries(manifest?.tools?.builtin ?? {}).sort(([aId], [bId]) => aId.localeCompare(bId));
  const skills = manifest?.skills;
  const memory = manifest?.memory;
  const boundaries = manifest?.boundaries;

  return (
    <SettingsFormSection>
      <SettingsFormSectionHeader
        icon={ListChecks}
        title={a.effectiveTitle}
        subtitle={a.effectiveHint}
      />
      {isLoading ? (
        <p className="text-sm text-fg-muted">{a.effectiveLoading}</p>
      ) : error ? (
        <p className="text-sm text-red-600 dark:text-red-400">
          {error instanceof Error ? error.message : a.effectiveError}
        </p>
      ) : !manifest ? (
        <p className="text-sm text-fg-muted">{a.effectiveEmpty}</p>
      ) : (
        <div>
          <div className="flex flex-col gap-5">
            <div>
              <h4 className="mb-2 text-xs font-semibold uppercase tracking-wide text-fg-muted">
                {a.effectivePresetChain}
              </h4>
              <div className="rounded-lg border border-edge-subtle bg-surface-panel px-3 py-2 text-sm text-fg">
                {presetChain.length ? presetChain.join(' -> ') : a.effectiveNoPresets}
              </div>
            </div>

            <div>
              <h4 className="mb-2 text-xs font-semibold uppercase tracking-wide text-fg-muted">
                {a.effectiveModelsTitle}
              </h4>
              <div className="flex flex-col gap-2">
                <PolicyRow
                  name="defaultRole"
                  value={manifest.models?.defaultRole ?? '—'}
                  source={sourceFor(sources, ['models.defaultRole'])}
                />
                {modelRoles.map(([id, role]) => (
                  <PolicyRow
                    key={id}
                    name={id}
                    value={role.model}
                    monoValue
                    source={sourceFor(sources, [`models.roles.${id}.model`, `models.roles.${id}`])}
                  />
                ))}
              </div>
            </div>

            <div>
              <h4 className="mb-2 text-xs font-semibold uppercase tracking-wide text-fg-muted">
                {a.effectiveToolsTitle}
              </h4>
              {toolPolicies.length > 0 ? (
                <div className="flex flex-col gap-2">
                  {toolPolicies.map(([id, policy]) => (
                    <PolicyRow
                      key={id}
                      name={id}
                      value={policy.mode}
                      source={sourceFor(sources, [`tools.builtin.${id}.mode`, `tools.builtin.${id}`])}
                    />
                  ))}
                </div>
              ) : (
                <p className="rounded-lg border border-dashed border-edge-subtle px-3 py-2 text-sm text-fg-muted">
                  {a.effectiveNoToolPolicies}
                </p>
              )}
            </div>

            <div>
              <h4 className="mb-2 text-xs font-semibold uppercase tracking-wide text-fg-muted">
                {a.effectiveSkillsTitle}
              </h4>
              <div className="flex flex-col gap-2">
                <PolicyRow
                  name="mode"
                  value={skills?.mode ?? 'all'}
                  source={sourceFor(sources, ['skills.mode', 'skills'])}
                />
                {skills?.mode === 'allowlist' ? (
                  <PolicyRow
                    name="allow"
                    value={listValue(skills.allow, '—')}
                    source={sourceFor(sources, ['skills.allow', 'skills'])}
                  />
                ) : null}
                {skills?.mode === 'denylist' ? (
                  <PolicyRow
                    name="deny"
                    value={listValue(skills.deny, '—')}
                    source={sourceFor(sources, ['skills.deny', 'skills'])}
                  />
                ) : null}
              </div>
            </div>

            <div>
              <h4 className="mb-2 text-xs font-semibold uppercase tracking-wide text-fg-muted">
                {a.effectiveMemoryTitle}
              </h4>
              <div className="flex flex-col gap-2">
                <PolicyRow
                  name="mode"
                  value={memory?.mode ?? 'off'}
                  source={sourceFor(sources, ['memory.mode', 'memory'])}
                />
                <PolicyRow
                  name="sources"
                  value={listValue(memory?.sources, '—')}
                  source={sourceFor(sources, ['memory.sources', 'memory'])}
                />
              </div>
            </div>

            <div>
              <h4 className="mb-2 text-xs font-semibold uppercase tracking-wide text-fg-muted">
                {a.effectiveBoundariesTitle}
              </h4>
              <div className="flex flex-col gap-2">
                <PolicyRow
                  name="requiresConfirmation"
                  value={listValue(boundaries?.requiresConfirmation, '—')}
                  source={sourceFor(sources, ['boundaries.requiresConfirmation', 'boundaries'])}
                />
                <PolicyRow
                  name="forbidden"
                  value={listValue(boundaries?.forbidden, '—')}
                  source={sourceFor(sources, ['boundaries.forbidden', 'boundaries'])}
                />
                <PolicyRow
                  name="escalation"
                  value={listValue(boundaries?.escalation, '—')}
                  source={sourceFor(sources, ['boundaries.escalation', 'boundaries'])}
                />
              </div>
            </div>
          </div>
        </div>
      )}
    </SettingsFormSection>
  );
}
