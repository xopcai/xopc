import { Button } from '@/components/ui/button';
import type { GatewayAgentRow } from '@/features/settings/agents-admin-api';
import { agentListDisplayName } from '@/features/settings/agents/agent-display-names';
import type { AgentsSettingsMessages } from '@/i18n/messages';
import { cn } from '@/lib/cn';

import { agentsSettingsInputClass } from './utils';

export function TuiDefaultAgentSetting({
  a,
  agents,
  savedAgentId,
  effectiveAgentId,
  globalDefaultAgentId,
  draftAgentId,
  unavailable,
  busy,
  onDraftChange,
  onSave,
}: {
  a: AgentsSettingsMessages;
  agents: GatewayAgentRow[];
  savedAgentId: string;
  effectiveAgentId: string;
  globalDefaultAgentId: string;
  draftAgentId: string;
  unavailable: boolean;
  busy: boolean;
  onDraftChange: (agentId: string) => void;
  onSave: () => void;
}) {
  if (agents.length === 0) return null;
  const dirty = draftAgentId !== savedAgentId;
  const globalDefaultAgent = agents.find((agent) => agent.id === globalDefaultAgentId);
  const effectiveAgent = agents.find((agent) => agent.id === effectiveAgentId);
  const globalDefaultLabel = globalDefaultAgent
    ? `${agentListDisplayName(globalDefaultAgent, a)} · ${globalDefaultAgent.id}`
    : globalDefaultAgentId;
  const effectiveLabel = effectiveAgent
    ? `${agentListDisplayName(effectiveAgent, a)} · ${effectiveAgent.id}`
    : effectiveAgentId;

  return (
    <section className="rounded-lg border border-edge bg-surface-panel px-4 py-3 shadow-surface">
      <div className="flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
        <div className="min-w-0">
          <h2 className="text-sm font-semibold text-fg">{a.tuiDefaultAgentTitle}</h2>
          <p className="mt-1 text-xs text-fg-muted">{a.tuiDefaultAgentHint}</p>
          {effectiveLabel ? (
            <p className="mt-1 text-xs text-fg-muted">
              {savedAgentId && !unavailable
                ? a.tuiDefaultAgentExplicitStatus.replace('{{agent}}', effectiveLabel)
                : a.tuiDefaultAgentInheritedStatus.replace('{{agent}}', effectiveLabel)}
            </p>
          ) : null}
          {unavailable ? (
            <p className="mt-1 text-xs text-amber-700 dark:text-amber-300">
              {a.tuiDefaultAgentUnavailable.replace('{{agentId}}', savedAgentId)}
            </p>
          ) : null}
        </div>
        <div className="flex min-w-0 flex-col gap-2 sm:flex-row sm:items-center">
          <select
            value={draftAgentId}
            disabled={busy}
            onChange={(event) => onDraftChange(event.target.value)}
            aria-label={a.tuiDefaultAgentTitle}
            className={cn(agentsSettingsInputClass(), 'min-w-48 bg-surface-base py-2')}
          >
            <option value="">
              {a.tuiDefaultAgentInheritOption.replace('{{agent}}', globalDefaultLabel)}
            </option>
            {agents.map((agent) => {
              const label = agentListDisplayName(agent, a);
              return (
                <option key={agent.id} value={agent.id}>
                  {`${label} · ${agent.id}`}
                </option>
              );
            })}
          </select>
          <Button
            type="button"
            variant="secondary"
            disabled={busy || !dirty}
            onClick={onSave}
            className="shrink-0"
          >
            {busy ? a.tuiDefaultAgentSaving : dirty ? a.tuiDefaultAgentSave : a.tuiDefaultAgentSaved}
          </Button>
        </div>
      </div>
    </section>
  );
}
