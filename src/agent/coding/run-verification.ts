import type { AfterToolCallContext, AgentToolResult } from '@earendil-works/pi-agent-core';

import { classifyVerificationCommand } from './verification-command.js';
import { readWorkspaceRevision } from './workspace-revision.js';

export interface CodingVerificationEvidence {
  command: string;
  kind: 'check' | 'diff-review';
  status: 'passed' | 'failed' | 'unverified';
  revision?: string;
  toolCallId: string;
  durationMs?: number;
  logPath?: string;
}

const READ_ONLY_TOOLS = new Set(['read_file', 'grep', 'find', 'list_dir', 'update_plan', 'session_status']);

function record(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' ? value as Record<string, unknown> : {};
}

export function toolResultFailed(result: AgentToolResult<unknown>, isError = false): boolean {
  const details = record(result.details);
  return isError || ['failed', 'blocked', 'timed_out', 'cancelled', 'interrupted'].includes(String(details.status))
    || details.timedOut === true || (typeof details.exitCode === 'number' && details.exitCode !== 0);
}

/** One run owns its evidence; transcript tool results are the durable record. */
export class RunVerification {
  private revision?: string;
  private changed = false;
  private readonly before = new Map<string, string | undefined>();
  private readonly evidence = new Map<string, CodingVerificationEvidence>();

  constructor(private readonly snapshot: () => Promise<string | undefined>) {}

  static async open(workspace: string): Promise<RunVerification> {
    const run = new RunVerification(() => readWorkspaceRevision(workspace));
    run.revision = await run.snapshot();
    return run;
  }

  restore(value: unknown, includeEvidence: boolean): void {
    const checkpoint = record(value);
    this.changed ||= checkpoint.changed === true || (typeof checkpoint.revision === 'string' && checkpoint.revision !== this.revision);
    if (!includeEvidence) return;
    for (const raw of Array.isArray(checkpoint.evidence) ? checkpoint.evidence : []) {
      const item = record(raw);
      if (typeof item.command !== 'string' || typeof item.toolCallId !== 'string'
        || !['check', 'diff-review'].includes(String(item.kind))) continue;
      const revision = typeof item.revision === 'string' ? item.revision : undefined;
      this.evidence.set(item.command, {
        command: item.command, toolCallId: item.toolCallId, kind: item.kind as CodingVerificationEvidence['kind'], revision,
        status: revision && revision === this.revision && ['passed', 'failed'].includes(String(item.status))
          ? item.status as 'passed' | 'failed' : 'unverified',
      });
    }
  }

  async beforeTool(toolCallId: string, toolName?: string): Promise<void> {
    const revision = toolName && READ_ONLY_TOOLS.has(toolName) ? this.revision : await this.snapshot();
    this.observeRevision(revision);
    this.before.set(toolCallId, revision);
  }

  async afterTool(context: AfterToolCallContext): Promise<{ result: AgentToolResult<unknown>; isError: boolean }> {
    const { toolCall, args, result } = context;
    const before = this.before.get(toolCall.id);
    this.before.delete(toolCall.id);
    const revision = READ_ONLY_TOOLS.has(toolCall.name) ? this.revision : await this.snapshot();
    this.observeRevision(revision);
    const details = record(result.details);
    const isError = toolResultFailed(result, context.isError);
    const mutation = toolCall.name === 'apply_patch' || toolCall.name === 'write_file';
    if (mutation && !isError) this.changed = true;
    const command = toolCall.name === 'exec_command' || toolCall.name === 'managed_job' || toolCall.name === 'language_diagnostics' || toolCall.name === 'review_workspace'
      ? String(details.command ?? record(args).cmd ?? '') : '';
    const kind = toolCall.name === 'review_workspace' && details.complete === true ? 'diff-review' : toolCall.name === 'language_diagnostics' && details.diagnosticEngine === 'typescript' ? 'check' : classifyVerificationCommand(command);
    let verification: CodingVerificationEvidence | undefined;
    if (kind && details.status !== 'running') {
      const observedBefore = typeof details.startRevision === 'string' ? details.startRevision : before;
      const observedAfter = typeof details.endRevision === 'string' ? details.endRevision : revision;
      const completedJob = toolCall.name !== 'managed_job' || !!details.startRevision && !!details.endRevision;
      verification = {
        command, kind, toolCallId: toolCall.id,
        ...(typeof details.durationMs === 'number' ? { durationMs: details.durationMs } : {}),
        ...(typeof details.logPath === 'string' ? { logPath: details.logPath } : {}),
        status: isError ? 'failed' : details.exitCode === 0 && completedJob && revision && revision === observedBefore && revision === observedAfter ? 'passed' : 'unverified',
        ...(revision ? { revision } : {}),
      };
      this.evidence.set(command, verification);
    }
    const pending = this.pendingEvidence();
    const verificationHint = !kind && toolCall.name === 'exec_command' && pending.includes('check')
      ? 'This command did not record a check. Save an assertion test, then run a standalone test command such as node --test verify.test.cjs; do not chain, pipe, or delete the test before completion.' : '';
    const receipt = this.changed && (mutation || command) ? [
      `Verification pending for current files: ${pending.length ? pending.map(item => item === 'diff-review' ? 'review_workspace' : 'standalone assertion test').join(', ') : 'none'}.`,
      verificationHint,
    ].filter(Boolean).join(' ') : '';
    return {
      isError,
      result: {
        ...result,
        content: [...result.content, ...(receipt ? [{ type: 'text' as const, text: receipt }] : [])],
        details: {
          ...details,
          workspaceRevision: revision ?? null,
          workspaceChanged: this.changed,
          ...(verification ? { verification } : {}),
          ...(this.changed ? {
            verificationPending: pending,
            ...(verificationHint ? { verificationHint } : {}),
          } : {}),
        },
      },
    };
  }

  private observeRevision(revision: string | undefined): void {
    if (this.revision && revision !== this.revision) this.changed = true;
    this.revision = revision;
  }

  private pendingEvidence(): CodingVerificationEvidence['kind'][] {
    const current = [...this.evidence.values()].filter(item => item.revision && item.revision === this.revision);
    return (['check', 'diff-review'] as const).filter(kind =>
      !current.some(item => item.kind === kind && item.status === 'passed')
      || current.some(item => item.kind === kind && item.status === 'failed'));
  }

  modelGuidance(): string {
    const focus = 'Read the inputs named by the current request directly. Inspect another file only for a concrete dependency or unresolved fact; directory neighbors are not dependencies. Reuse facts already read. Finish the requested changes before checking; avoid generalizing a bounded task into extra parsing, hardening, or documentation work. For JSON deliverables, match the requested container and exact field set. A single result described by named fields is an object; use a collection only when requested. Honor literal scalar field values and precision. Assert this contract independently before checking calculations; do not validate extra fields or a changed container against your own generated output.';
    if (!this.changed) return `Execution phase: focused implementation. ${focus}`;
    const pending = this.pendingEvidence();
    if (pending.length === 0) return 'Execution phase: verification complete for the observed workspace revision. If the requested result is complete, give the final answer now. Files already captured successfully by exec_command.outputs or publish_artifacts do not need republishing unless changed; publish only missing or stale deliverables. Do not rerun successful checks, reread inputs, add validation, refactor, or polish the report. Edit again only for a concrete unmet user requirement or demonstrated correctness defect, then reverify the affected result. Passing checks alone does not establish that every user requirement is met.';
    return `Execution phase: complete only outstanding requirements, then verify once. ${focus} Still missing: ${pending.map(kind => kind === 'check' ? 'a successful standalone assertion test' : 'review_workspace').join(', ')}. Use exec_command.outputs on the final standalone check to capture all final deliverables together, including files written earlier; no separate publishing call is needed for successful unchanged artifacts. Reuse current successful evidence for the other kind; a further file change invalidates it. If review finds no task-relevant defect, finish instead of making discretionary edits.`;
  }

  async pendingContext(): Promise<string> {
    this.observeRevision(await this.snapshot());
    if (!this.changed) return '';
    const current = [...this.evidence.values()].filter((item) => item.revision && item.revision === this.revision);
    const checked = current.some((item) => item.kind === 'check' && item.status === 'passed');
    const reviewed = current.some((item) => item.kind === 'diff-review' && item.status === 'passed');
    const failed = current.filter((item) => item.kind === 'check' && item.status === 'failed');
    if (checked && reviewed && failed.length === 0) return '';
    return [
      'Workspace changes still need verification against the current files.',
      ...(!reviewed ? ['Inspect tracked and untracked changes using `review_workspace`.'] : []),
      ...(!checked ? ['Run the smallest meaningful check as a direct command using exec_command.'] : []),
      ...failed.map((item) => `Resolve or explicitly report the failed check: ${item.command}`),
      'If a check is unavailable or unrelated to the requested change, report what remains unverified and why. Do not claim verified completion.',
    ].join('\n');
  }

  async summary(): Promise<{ changed: boolean; revision?: string; evidence: CodingVerificationEvidence[] }> {
    this.observeRevision(await this.snapshot());
    return {
      changed: this.changed,
      revision: this.revision,
      evidence: [...this.evidence.values()].map((item) => ({
        ...item,
        status: !item.revision || item.revision !== this.revision ? 'unverified' : item.status,
      })),
    };
  }
}
