import { readFileSync } from 'node:fs';

function record(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' ? value as Record<string, unknown> : {};
}

/** Descriptive trace metrics, never additional task graders or inferred filesystem auditing. */
export function summarizeToolTrace(events: Record<string, unknown>[], artifacts: Record<string, unknown>[]) {
  const calls = new Map<string, {name: string; args: Record<string, unknown>}>();
  const reads = new Set<string>();
  const successful = new Set<string>();
  const toolCounts: Record<string, number> = {};
  let finished = 0, missing = 0, repeated = 0, editsAfterCheck = 0, readsAfterCheck = 0;
  let revision: string | undefined, checkedRevision: string | undefined;
  for (const event of events) {
    let outer = record(JSON.parse(String(event.payload_json)));
    if (outer.truncated === true) {
      const refs = JSON.parse(String(event.artifact_refs_json ?? '[]')) as string[];
      const artifact = artifacts.find(item => refs.includes(String(item.id)) && String(item.kind).startsWith('trace-payload-'));
      try { outer = record(JSON.parse(readFileSync(String(artifact?.path), 'utf8'))); }
      catch { if (event.type === 'tool.finished') { finished++; missing++; } continue; }
    }
    const payload = record(outer.payload);
    const id = String(payload.toolCallId ?? '');
    if (event.type === 'tool.started') {
      const name = String(payload.toolName ?? 'unknown');
      const args = record(payload.args);
      toolCounts[name] = (toolCounts[name] ?? 0) + 1;
      calls.set(id, {name, args});
      if (name === 'read_file' && typeof args.path === 'string') reads.add(args.path);
      if (checkedRevision && revision === checkedRevision) {
        if (name === 'read_file') readsAfterCheck++;
        if (name === 'write_file' || name === 'apply_patch') editsAfterCheck++;
      }
    } else if (event.type === 'tool.finished') {
      finished++;
      const details = record(record(payload.result).details);
      const nextRevision = typeof details.workspaceRevision === 'string' ? details.workspaceRevision : undefined;
      const call = calls.get(id);
      if (payload.status === 'success' && call && revision && nextRevision === revision) {
        const signature = JSON.stringify([outer.turnIndex, revision, call.name, call.args]);
        if (successful.has(signature)) repeated++;
        successful.add(signature);
      }
      revision = nextRevision;
      const verification = record(details.verification);
      if (verification.kind === 'check' && verification.status === 'passed' && nextRevision) checkedRevision = nextRevision;
    }
  }
  return { toolCounts, distinctExplicitReadPaths: [...reads].sort(), toolCompletionCoverage: {total: finished, recovered: finished-missing},
    repeatedSuccessfulCallsAtObservedRevision: missing ? null : repeated,
    explicitEditsAfterSuccessfulCheckAtObservedRevision: missing ? null : editsAfterCheck,
    explicitReadsAfterSuccessfulCheckAtObservedRevision: missing ? null : readsAfterCheck,
    limitations: 'Counts model-visible tools only. Identical arguments are compared verbatim; shell I/O and semantic necessity are not inferred. Missing trace payloads yield null diagnostic totals.' };
}
