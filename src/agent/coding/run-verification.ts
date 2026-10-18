import type { AfterToolCallContext, AgentToolResult } from '@earendil-works/pi-agent-core';

import { extname, resolve } from 'node:path';

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

type VerificationOptions = { required?: boolean; toolNames?: string[]; workspace?: string };

function mutationPaths(name: string, args: Record<string, unknown>): string[] {
  return (name === 'write_file' ? [args.path]
    : name === 'apply_patch' ? [...String(args.patch ?? '').matchAll(/^\*\*\* (?:Add File|Update File|Delete File|Move to): (.+)$/gm)].map(match => match[1]!.trim()) : [])
    .filter((path): path is string => typeof path === 'string');
}

function editsOnlyProse(name: string, args: Record<string, unknown>): boolean {
  const paths = mutationPaths(name, args);
  return paths.length > 0 && paths.every(path => typeof path === 'string' && ['.md', '.txt', '.rst', '.adoc'].includes(extname(path).toLowerCase()));
}

/** One run owns its evidence; transcript tool results are the durable record. */
export class RunVerification {
  private revision?: string;
  private changed = false;
  private proseOnly = true;
  private readonly before = new Map<string, string | undefined>();
  private readonly evidence = new Map<string, CodingVerificationEvidence>();
  private readonly successfulCommands = new Map<string, string>();
  private readonly editedProse = new Set<string>();
  private readonly inspectedProse = new Map<string, string>();

  constructor(private readonly snapshot: () => Promise<string | undefined>, private readonly options: VerificationOptions = {}) {}

  static async open(workspace: string, options: VerificationOptions = {}): Promise<RunVerification> {
    const run = new RunVerification(() => readWorkspaceRevision(workspace), { ...options, workspace });
    run.revision = await run.snapshot();
    return run;
  }

  restore(value: unknown, includeEvidence: boolean): void {
    const checkpoint = record(value);
    this.changed ||= checkpoint.changed === true || (typeof checkpoint.revision === 'string' && checkpoint.revision !== this.revision);
    if (this.changed) this.proseOnly &&= checkpoint.proseOnly === true
      && typeof checkpoint.revision === 'string' && checkpoint.revision === this.revision;
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
    const details = record(result.details);
    const isError = toolResultFailed(result, context.isError);
    const mutation = toolCall.name === 'apply_patch' || toolCall.name === 'write_file';
    this.observeRevision(revision, mutation && !isError);
    if (mutation && !isError) this.proseOnly &&= editsOnlyProse(toolCall.name, record(args));
    if (mutation && !isError) this.changed = true;
    if (mutation && !isError && this.proseOnly) {
      for (const path of mutationPaths(toolCall.name, record(args))) this.editedProse.add(resolve(this.options.workspace ?? '.', path));
    }
    if (toolCall.name === 'read_file' && !isError && revision && revision === before && details.truncated === false && details.offset === 1 && typeof record(args).path === 'string') {
      this.inspectedProse.set(resolve(this.options.workspace ?? '.', record(args).path as string), revision);
    }
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
    const commandKey = JSON.stringify([record(args).cwd ?? '', command]);
    const repeatedSuccess = toolCall.name === 'exec_command' && !isError && revision
      && this.successfulCommands.get(commandKey) === revision;
    if (toolCall.name === 'exec_command' && !isError && details.exitCode === 0 && revision === before && revision) {
      this.successfulCommands.set(commandKey, revision);
    }
    const verificationHint = this.options.required !== false && !kind && toolCall.name === 'exec_command' && pending.includes('check')
      ? 'This command did not record a check; repeating it will not supply missing evidence. Use the existing test runner as a standalone command. If the task has no tests and needs executable assertions, write one test file and run node --test path/to/file.test.mjs (never combine --test with --eval/-e); do not create another competing script. Finish requested files first; use cwd instead of cd, chains, or pipes.' : '';
    const receipt = this.options.required !== false && this.changed && (mutation || command) ? [
      `Verification pending for current files: ${pending.length ? pending.map(item => item === 'diff-review' ? this.hasTool('review_workspace') ? 'review_workspace' : 'content inspection' : 'standalone assertion test').join(', ') : 'none'}.`,
      verificationHint,
      verification?.kind === 'check' && verification.status === 'failed' ? 'Resolve the failing assertion against current requirements and source facts before rerunning. Fix the discrepancy, not the expected value blindly; inspect the environment only for an actual runtime error.' : '',
      repeatedSuccess ? 'This exact command already succeeded on the same workspace revision. Reuse its result; rerun only for a concrete freshness requirement or changed inputs.' : '',
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
          ...(this.options.required !== false && this.changed ? {
            verificationPending: pending,
            ...(verificationHint ? { verificationHint } : {}),
          } : {}),
        },
      },
    };
  }

  private observeRevision(revision: string | undefined, knownMutation = false): void {
    if (this.revision && revision !== this.revision) {
      this.changed = true;
      if (!knownMutation) this.proseOnly = false;
    }
    this.revision = revision;
  }

  private pendingEvidence(): CodingVerificationEvidence['kind'][] {
    const current = [...this.evidence.values()].filter(item => item.revision && item.revision === this.revision);
    const kinds: CodingVerificationEvidence['kind'][] = this.proseOnly && this.changed
      && !current.some(item => item.kind === 'check' && item.status === 'failed') ? ['diff-review'] : ['check', 'diff-review'];
    return kinds.filter(kind =>
      !current.some(item => item.kind === kind && item.status === 'passed')
      || current.some(item => item.kind === kind && item.status === 'failed'));
  }

  private hasTool(name: string): boolean {
    return this.options.toolNames === undefined || this.options.toolNames.includes(name);
  }

  modelGuidance(): string {
    if (this.options.required === false) {
      if (!this.changed || !this.proseOnly || this.editedProse.size === 0) return '';
      const inspected = !!this.revision && [...this.editedProse].every(path => this.inspectedProse.get(path) === this.revision);
      return inspected
        ? 'Document changes have been read back in full at the current revision. If all requested requirements are met, give the final answer now. Do not add Git, byte, checksum, or executable checks for wording alone; honor any explicitly requested validation or delivery. State limitations honestly; inspection is not a behavior-test receipt.'
        : 'For this prose-only edit, finish the requested wording, then inspect final content once with an available read tool. No assertion script, byte dump, or extra Git inspection is needed. Deliver the result with any capability limitations.';
    }
    const focus = 'Read the inputs named by the current request directly; search only if missing. Reuse observed facts. Check the requested schema independently: named fields require one root object, not an array/envelope; preserve JSON value types and add no unrequested keys. When the latest request replaces scope or names root fields, remove the superseded container and metadata; do not wrap the root fields in the old array. Small data tasks need the result, a concise method and an existing check, not a reusable pipeline or exhaustive report. On follow-up, update only affected artifacts and assertions; do not reread unchanged inputs or rebuild helpers unnecessarily.';
    if (!this.changed) return `Execution phase: focused implementation. ${focus} Choose an existing runner before editing; run it as the entire command, with no echo, hash, Git, chain, pipe or filter appended. If executable assertions are needed and none exists, use one node:test file with node --test path/to/file.test.mjs; plain node/python scripts and inline shell programs do not record behavior-check evidence. No assertion scripts for prose.`;
    const pending = this.pendingEvidence();
    const delivery = this.hasTool('exec_command') ? 'Link completed workspace files directly. Publish downloadable copies only when requested: plan outputs on the necessary final check in advance, never repeat a passing check to attach files. Reuse receipts; source, tests and helpers stay in the workspace unless explicitly requested.'
      : this.hasTool('publish_artifacts') ? 'Use publish_artifacts only for completed requested deliverables missing a successful receipt, never for blocked edits or source files.' : '';
    if (pending.length === 0) return `Execution phase: verification complete for the observed workspace revision. If all requested fields and deliverables are complete, give the final answer now, briefly linking them with verification and any limitation. Do not repeat input tables or the work log. ${delivery} Stop calling tools when requirements and valid evidence are complete. Do not rerun passing checks, regenerate outputs, publish extra copies, inspect Git/checksums, or edit for discretionary polish. Further edits invalidate current evidence; passing checks alone do not establish that all user requirements are met.`;
    const missing = pending.map(kind => kind === 'check' ? 'a successful standalone assertion test'
      : this.hasTool('review_workspace') ? 'review_workspace' : 'content inspection with available read tools');
    const focusForChange = this.proseOnly ? 'Inspect the changed prose for the requested content; no assertion script is required.' : focus;
    return `Execution phase: complete outstanding requirements, then verify once with a direct command (no cd, chains, or pipes). ${focusForChange} Still missing: ${missing.join(', ')}. ${delivery} Reuse valid evidence; report unavailable verification as a blocker rather than invoking tools outside the registered set.`;
  }

  async pendingContext(): Promise<string> {
    this.observeRevision(await this.snapshot());
    if (!this.changed || this.options.required === false) return '';
    const current = [...this.evidence.values()].filter((item) => item.revision && item.revision === this.revision);
    const checked = !this.pendingEvidence().includes('check');
    const reviewed = current.some((item) => item.kind === 'diff-review' && item.status === 'passed');
    const failed = current.filter((item) => item.kind === 'check' && item.status === 'failed');
    // Missing capabilities remain unverified; another model turn cannot supply them.
    if (!this.pendingEvidence().some(kind => kind === 'check'
      ? this.hasTool('exec_command') || this.hasTool('language_diagnostics')
      : this.hasTool('review_workspace'))) return '';
    if (checked && reviewed && failed.length === 0) return '';
    return [
      'Workspace changes still need verification against the current files.',
      ...(!reviewed ? [this.hasTool('review_workspace') ? 'Inspect tracked and untracked changes using `review_workspace`.' : 'Inspect final content with available read tools; report any verification that cannot be completed.'] : []),
      ...(!checked ? [this.hasTool('exec_command') ? 'Run the smallest meaningful check as a direct command using exec_command.' : 'A behavior check is still missing; use available verification tools or report why it is unavailable.'] : []),
      ...failed.map((item) => `Resolve or explicitly report the failed check: ${item.command}`),
      'If a check is unavailable or unrelated to the requested change, report what remains unverified and why. Do not claim verified completion.',
    ].join('\n');
  }

  async summary(): Promise<{ changed: boolean; proseOnly: boolean; revision?: string; evidence: CodingVerificationEvidence[] }> {
    this.observeRevision(await this.snapshot());
    return {
      changed: this.changed,
      proseOnly: this.proseOnly,
      revision: this.revision,
      evidence: [...this.evidence.values()].map((item) => ({
        ...item,
        status: !item.revision || item.revision !== this.revision ? 'unverified' : item.status,
      })),
    };
  }
}
