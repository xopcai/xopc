/**
 * Accumulated subagent stream text (thinking + assistant deltas).
 */

import { memo } from 'react';

export type WorkflowAgentStreamPanelLabels = {
  heading: string;
  empty: string;
};

export const WorkflowAgentStreamPanel = memo(function WorkflowAgentStreamPanel({
  streamText,
  labels,
}: {
  streamText: string | undefined;
  labels: WorkflowAgentStreamPanelLabels;
}) {
  const text = streamText?.trim();
  if (!text) {
    return <div className="text-xs text-fg-disabled">{labels.empty}</div>;
  }

  return (
    <div className="min-w-0">
      <div className="mb-1 text-[10px] font-medium uppercase tracking-wide text-fg-subtle">
        {labels.heading}
      </div>
      <pre className="max-h-64 min-w-0 overflow-y-auto whitespace-pre-wrap break-words rounded-md border border-edge-subtle bg-surface-hover/30 p-2 font-mono text-xs text-fg-muted">
        {text}
      </pre>
    </div>
  );
});
