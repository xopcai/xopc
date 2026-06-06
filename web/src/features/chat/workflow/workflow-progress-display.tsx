/**
 * Shared progress tree / agent status sections for workflow UIs.
 * Used by chat WorkflowCard and the gateway Workflows run detail panel.
 */

import { WorkflowAgentRow } from './workflow-agent-row';
import { WorkflowPhaseRow, type WorkflowPhaseRowLabels } from './workflow-phase-row';
import type { WorkflowAgentSnapshot } from './workflow.types';
import type { rollupPhases } from './workflow.utils';

export type WorkflowProgressLabels = {
  phase: WorkflowPhaseRowLabels;
  runningAgentsHeading: string;
  completedAgentsHeading: string;
  queuedAgentsHeading: string;
  failedAgentsHeading: string;
  recentLogsHeading: string;
  showAllLogs: string;
};

export function RunningProgressPanel({
  snapshot,
  labels,
  logsExpanded,
  onToggleLogs,
  selectedAgentId,
  onSelectAgent,
}: {
  snapshot: { agents: WorkflowAgentSnapshot[]; logs: string[] };
  labels: WorkflowProgressLabels;
  logsExpanded: boolean;
  onToggleLogs: () => void;
  selectedAgentId?: number | null;
  onSelectAgent?: (agent: WorkflowAgentSnapshot) => void;
}) {
  const runningAgents = snapshot.agents.filter((agent) => agent.status === 'running');
  const failedAgents = snapshot.agents.filter((agent) => agent.status === 'error' || agent.status === 'skipped');
  const completedAgents = snapshot.agents.filter((agent) => agent.status === 'done');
  const queuedAgents = snapshot.agents.filter((agent) => agent.status === 'queued');

  return (
    <div className="space-y-3">
      <AgentStatusSection
        heading={labels.runningAgentsHeading}
        agents={runningAgents}
        labels={labels.phase}
        selectedAgentId={selectedAgentId}
        onSelectAgent={onSelectAgent}
      />
      <AgentStatusSection
        heading={labels.failedAgentsHeading}
        agents={failedAgents}
        labels={labels.phase}
        selectedAgentId={selectedAgentId}
        onSelectAgent={onSelectAgent}
      />
      <AgentStatusSection
        heading={labels.completedAgentsHeading}
        agents={completedAgents}
        labels={labels.phase}
        selectedAgentId={selectedAgentId}
        onSelectAgent={onSelectAgent}
      />
      <AgentStatusSection
        heading={labels.queuedAgentsHeading}
        agents={queuedAgents}
        labels={labels.phase}
        selectedAgentId={selectedAgentId}
        onSelectAgent={onSelectAgent}
      />

      <RecentLogs
        recentLogs={snapshot.logs}
        recentLogsHeading={labels.recentLogsHeading}
        showAllLogsLabel={labels.showAllLogs}
        logsExpanded={logsExpanded}
        onToggleLogs={onToggleLogs}
      />
    </div>
  );
}

function AgentStatusSection({
  heading,
  agents,
  labels,
  selectedAgentId,
  onSelectAgent,
}: {
  heading: string;
  agents: WorkflowAgentSnapshot[];
  labels: WorkflowPhaseRowLabels;
  selectedAgentId?: number | null;
  onSelectAgent?: (agent: WorkflowAgentSnapshot) => void;
}) {
  if (agents.length === 0) return null;

  return (
    <section className="min-w-0">
      <div className="mb-1 text-[10px] font-medium uppercase tracking-wide text-fg-subtle">
        {heading}
      </div>
      <div className="space-y-0.5">
        {agents.map((agent) => (
          <WorkflowAgentRow
            key={agent.id}
            agent={agent}
            labels={labels}
            selected={selectedAgentId === agent.id}
            onSelect={onSelectAgent}
          />
        ))}
      </div>
    </section>
  );
}

function RecentLogs({
  recentLogs,
  recentLogsHeading,
  showAllLogsLabel,
  logsExpanded,
  onToggleLogs,
}: {
  recentLogs: string[];
  recentLogsHeading: string;
  showAllLogsLabel: string;
  logsExpanded: boolean;
  onToggleLogs: () => void;
}) {
  const visibleLogs =
    logsExpanded || recentLogs.length <= 2 ? recentLogs : recentLogs.slice(-2);

  if (recentLogs.length === 0) return null;

  return (
    <div className="border-t border-edge-subtle pt-2">
      <div className="mb-1 flex items-center justify-between gap-2">
        <div className="text-[10px] font-medium uppercase tracking-wide text-fg-subtle">
          {recentLogsHeading}
        </div>
        {recentLogs.length > 2 ? (
          <button
            type="button"
            onClick={onToggleLogs}
            className="text-[10px] text-accent-fg hover:underline"
          >
            {showAllLogsLabel}
          </button>
        ) : null}
      </div>
      <div className="space-y-0.5">
        {visibleLogs.map((line, index) => (
          <div key={index} className="break-words font-mono text-xs text-fg-subtle">
            {line}
          </div>
        ))}
      </div>
    </div>
  );
}

export function ProgressTree({
  rollup,
  currentPhase,
  labels,
  recentLogs,
  recentLogsHeading,
  showAllLogsLabel,
  logsExpanded,
  onToggleLogs,
  selectedAgentId,
  onSelectAgent,
}: {
  rollup: ReturnType<typeof rollupPhases>;
  currentPhase: string | undefined;
  labels: WorkflowPhaseRowLabels;
  recentLogs: string[];
  recentLogsHeading: string;
  showAllLogsLabel: string;
  logsExpanded: boolean;
  onToggleLogs: () => void;
  selectedAgentId?: number | null;
  onSelectAgent?: (agent: WorkflowAgentSnapshot) => void;
}) {
  const visibleLogs =
    logsExpanded || recentLogs.length <= 2 ? recentLogs : recentLogs.slice(-2);

  return (
    <div className="space-y-1">
      {rollup.phases.map((p) => (
        <WorkflowPhaseRow
          key={p.title}
          rollup={p}
          isCurrent={p.title === currentPhase}
          labels={labels}
          selectedAgentId={selectedAgentId}
          onSelectAgent={onSelectAgent}
        />
      ))}
      {rollup.unphased ? (
        <WorkflowPhaseRow
          rollup={rollup.unphased}
          isCurrent={false}
          labels={labels}
          selectedAgentId={selectedAgentId}
          onSelectAgent={onSelectAgent}
        />
      ) : null}
      {recentLogs.length > 0 ? (
        <div className="mt-2 border-t border-edge-subtle pt-2">
          <div className="mb-1 flex items-center justify-between gap-2">
            <div className="text-[10px] font-medium uppercase tracking-wide text-fg-subtle">
              {recentLogsHeading}
            </div>
            {recentLogs.length > 2 ? (
              <button
                type="button"
                onClick={onToggleLogs}
                className="text-[10px] text-accent-fg hover:underline"
              >
                {showAllLogsLabel}
              </button>
            ) : null}
          </div>
          <div className="space-y-0.5">
            {visibleLogs.map((line, i) => (
              <div key={i} className="break-words font-mono text-xs text-fg-subtle">
                {line}
              </div>
            ))}
          </div>
        </div>
      ) : null}
    </div>
  );
}
