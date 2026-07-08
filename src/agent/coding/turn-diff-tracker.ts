export type WorkspaceMutationKind = 'add' | 'update' | 'delete' | 'move' | 'rewrite' | 'unknown';

export interface TurnFileChange {
  kind: WorkspaceMutationKind;
  path: string;
  moveTo?: string;
  added?: number;
  removed?: number;
  diff?: string;
  toolName: string;
  at: number;
}

export interface TurnVerificationRecord {
  toolName: string;
  command?: string;
  success: boolean;
  status?: string;
  exitCode?: number | null;
  timedOut?: boolean;
}

export interface TurnDiffState {
  sessionKey: string;
  turnId: string;
  changedFiles: string[];
  changes: TurnFileChange[];
  cumulativeDiff: string;
  added: number;
  removed: number;
  dirty: boolean;
  dirtyReason?: string;
  diffReviewed: boolean;
  verificationAttempted: boolean;
  lastVerification?: TurnVerificationRecord;
}

const DEFAULT_TURN_ID = 'default';

function createState(sessionKey: string, turnId = DEFAULT_TURN_ID): TurnDiffState {
  return {
    sessionKey,
    turnId,
    changedFiles: [],
    changes: [],
    cumulativeDiff: '',
    added: 0,
    removed: 0,
    dirty: false,
    diffReviewed: false,
    verificationAttempted: false,
  };
}

function readRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === 'object' ? (value as Record<string, unknown>) : null;
}

function readDetails(result: unknown): Record<string, unknown> | null {
  const rec = readRecord(result);
  return readRecord(rec?.details);
}

function readString(value: unknown): string | undefined {
  return typeof value === 'string' && value.trim() ? value : undefined;
}

function readNumber(value: unknown): number | undefined {
  return typeof value === 'number' && Number.isFinite(value) ? value : undefined;
}

function readExitCode(value: unknown): number | null | undefined {
  if (typeof value === 'number' && Number.isFinite(value)) return value;
  if (value === null) return null;
  return undefined;
}

function readStringArray(value: unknown): string[] {
  return Array.isArray(value) ? value.filter((item): item is string => typeof item === 'string' && item.trim().length > 0) : [];
}

function uniqueSorted(values: Iterable<string>): string[] {
  return Array.from(new Set(Array.from(values).filter(Boolean))).sort();
}

function extractExecCommand(args?: unknown, result?: unknown): string {
  const argRec = readRecord(args);
  const fromArgs = readString(argRec?.cmd) ?? readString(argRec?.command);
  if (fromArgs) return fromArgs;
  const details = readDetails(result);
  return readString(details?.command) ?? '';
}

function isDiffReviewCommand(command: string): boolean {
  return /\bgit\s+(diff|status)\b/i.test(command);
}

function isVerificationCommand(command: string): boolean {
  return /\b(test|vitest|jest|mocha|ava|playwright|typecheck|type-check|tsc|build|lint)\b/i.test(command);
}

function commandMayMutateWorkspace(command: string): boolean {
  return /\b(sed\s+-i|perl\s+-pi|rm\s+|mv\s+|cp\s+|git\s+(checkout|reset|clean|apply|merge|rebase)|writeFile|write\(|open\([^)]*['"]w['"])/i.test(command);
}

function execSuccess(isError: boolean | undefined, result: unknown): boolean {
  if (isError) return false;
  const details = readDetails(result);
  if (!details) return false;
  if (details.timedOut === true) return false;
  if (details.status === 'success') return true;
  return details.exitCode === 0;
}

function appendSection(lines: string[], title: string, body: string[]): void {
  if (body.length === 0) return;
  lines.push(title, ...body);
}

export class TurnDiffTracker {
  private readonly states = new Map<string, TurnDiffState>();

  beginTurn(sessionKey: string, turnId = `${Date.now()}`): void {
    this.states.set(sessionKey, createState(sessionKey, turnId));
  }

  getState(sessionKey: string): TurnDiffState {
    const state = this.states.get(sessionKey) ?? createState(sessionKey);
    return {
      ...state,
      changedFiles: [...state.changedFiles],
      changes: state.changes.map((change) => ({ ...change })),
      lastVerification: state.lastVerification ? { ...state.lastVerification } : undefined,
    };
  }

  reset(sessionKey: string): void {
    this.states.delete(sessionKey);
  }

  recordToolResult(input: {
    sessionKey: string;
    toolName: string;
    args?: unknown;
    result?: unknown;
    isError?: boolean;
  }): void {
    if (input.isError) return;
    const name = input.toolName.toLowerCase();
    if (name === 'apply_patch') {
      this.recordApplyPatch(input.sessionKey, input.toolName, input.result);
      return;
    }
    if (name === 'write_file') {
      this.recordWriteFile(input.sessionKey, input.toolName, input.args, input.result);
      return;
    }
    if (name === 'exec_command') {
      this.recordExecCommand(input.sessionKey, input.toolName, input.args, input.result, input.isError);
    }
  }

  recordMutation(input: { sessionKey: string; toolName: string; changes: TurnFileChange[] }): void {
    const state = this.mutableState(input.sessionKey);
    for (const change of input.changes) {
      state.changes.push({ ...change, toolName: input.toolName });
      state.added += change.added ?? 0;
      state.removed += change.removed ?? 0;
      if (change.diff) {
        state.cumulativeDiff = [state.cumulativeDiff.trimEnd(), change.diff.trimEnd()]
          .filter(Boolean)
          .join('\n');
      }
    }
    state.changedFiles = uniqueSorted([
      ...state.changedFiles,
      ...input.changes.flatMap((change) => [change.path, change.moveTo].filter(Boolean) as string[]),
    ]);
  }

  recordDiffReviewed(sessionKey: string): void {
    this.mutableState(sessionKey).diffReviewed = true;
  }

  recordVerification(input: {
    sessionKey: string;
    toolName: string;
    command?: string;
    success: boolean;
    status?: string;
    exitCode?: number | null;
    timedOut?: boolean;
  }): void {
    const state = this.mutableState(input.sessionKey);
    state.verificationAttempted = true;
    state.lastVerification = {
      toolName: input.toolName,
      command: input.command,
      success: input.success,
      status: input.status,
      exitCode: input.exitCode,
      timedOut: input.timedOut,
    };
  }

  markDirty(sessionKey: string, reason: string): void {
    const state = this.mutableState(sessionKey);
    state.dirty = true;
    state.dirtyReason = reason;
  }

  buildFinalGuardContext(sessionKey: string): string {
    const state = this.states.get(sessionKey);
    if (!state) return '';
    const hasChanges = state.changedFiles.length > 0 || state.changes.length > 0 || state.dirty;
    if (!hasChanges) return '';

    const needsDiff = !state.diffReviewed;
    const needsVerification = !state.verificationAttempted;
    const failedVerification = state.lastVerification && !state.lastVerification.success;
    if (!needsDiff && !needsVerification && !failedVerification) return '';

    const lines: string[] = ['## Coding final check reminder'];
    if (state.changedFiles.length > 0) {
      appendSection(lines, 'This turn changed workspace files:', state.changedFiles.map((file) => `- ${file}`));
    }
    if (state.dirty && needsDiff) {
      lines.push(`A command may have modified the workspace${state.dirtyReason ? `: ${state.dirtyReason}` : '.'}`);
    }
    const actions: string[] = [];
    if (needsDiff) actions.push('- Inspect the diff/status with `git_status` before final response.');
    if (needsVerification) actions.push('- Run the smallest meaningful verification command if feasible.');
    if (failedVerification) {
      const v = state.lastVerification!;
      actions.push(`- Last verification failed${v.command ? `: ${v.command}` : ''}. Do not claim success until fixed or clearly report the blocker.`);
    }
    actions.push('- If skipping verification, say why in the final answer.');
    appendSection(lines, 'Before final response:', actions);
    return lines.join('\n');
  }

  private mutableState(sessionKey: string): TurnDiffState {
    let state = this.states.get(sessionKey);
    if (!state) {
      state = createState(sessionKey);
      this.states.set(sessionKey, state);
    }
    return state;
  }

  private recordApplyPatch(sessionKey: string, toolName: string, result: unknown): void {
    const details = readDetails(result);
    if (!details) return;
    const now = Date.now();
    const rawChanges = Array.isArray(details.changes) ? details.changes : [];
    const changes: TurnFileChange[] = rawChanges.flatMap((raw) => {
      const rec = readRecord(raw);
      const path = readString(rec?.path);
      if (!path) return [];
      return [{
        kind: (readString(rec?.kind) as WorkspaceMutationKind | undefined) ?? 'update',
        path,
        moveTo: readString(rec?.moveTo),
        added: readNumber(rec?.added),
        removed: readNumber(rec?.removed),
        diff: readString(rec?.diff),
        toolName,
        at: now,
      }];
    });
    if (changes.length === 0) {
      const files = readStringArray(details.files);
      for (const file of files) {
        changes.push({ kind: 'unknown', path: file, toolName, at: now });
      }
    }
    this.recordMutation({ sessionKey, toolName, changes });
    const state = this.mutableState(sessionKey);
    state.added = readNumber(details.added) ?? state.added;
    state.removed = readNumber(details.removed) ?? state.removed;
    const diff = readString(details.diff);
    if (diff && !state.cumulativeDiff.includes(diff.trim())) {
      state.cumulativeDiff = [state.cumulativeDiff.trimEnd(), diff.trimEnd()].filter(Boolean).join('\n');
    }
  }

  private recordWriteFile(sessionKey: string, toolName: string, args: unknown, result: unknown): void {
    const details = readDetails(result);
    if (typeof details?.size !== 'number') return;
    const path = readString(readRecord(args)?.path);
    if (!path) return;
    this.recordMutation({
      sessionKey,
      toolName,
      changes: [{ kind: 'rewrite', path, toolName, at: Date.now() }],
    });
    this.markDirty(sessionKey, '`write_file` rewrote file content without a captured unified diff');
  }

  private recordExecCommand(sessionKey: string, toolName: string, args: unknown, result: unknown, isError?: boolean): void {
    const command = extractExecCommand(args, result);
    const details = readDetails(result);
    if (command && isDiffReviewCommand(command)) {
      this.recordDiffReviewed(sessionKey);
    }
    if (command && isVerificationCommand(command)) {
      this.recordVerification({
        sessionKey,
        toolName,
        command,
        success: execSuccess(isError, result),
        status: readString(details?.status),
        exitCode: readExitCode(details?.exitCode),
        timedOut: details?.timedOut === true,
      });
    }
    if (command && commandMayMutateWorkspace(command)) {
      this.markDirty(sessionKey, `exec_command may have changed files: ${command.slice(0, 120)}`);
    }
  }
}
