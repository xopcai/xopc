/**
 * Self-Verification Middleware
 *
 * Implements the "Build & Self-Verify" pattern from harness engineering:
 * - Intercepts agent before completion to remind verification
 * - Tracks file edits to detect potential issues
 * - Injects verification reminders into context
 *
 * Inspired by: https://blog.langchain.com/improving-deep-agents-with-harness-engineering/
 */

import { createLogger } from '../../utils/logger.js';

const log = createLogger('SelfVerifyMiddleware');

export interface FileEditRecord {
  path: string;
  editCount: number;
  lastEditTime: number;
  operations: string[]; // 'write', 'edit', 'command' (for build commands)
}

export interface SelfVerifyConfig {
  /** Max edits to same file before warning (default: 5) */
  maxEditsPerFile: number;
  /** Enable pre-completion verification check (default: true) */
  enablePreCompletionCheck: boolean;
  /** Min turns before triggering verification reminder (default: 3) */
  minTurnsForVerification: number;
  /** Reset counters on successful verification (default: true) */
  resetOnVerification: boolean;
}

const DEFAULT_CONFIG: SelfVerifyConfig = {
  maxEditsPerFile: 5,
  enablePreCompletionCheck: true,
  minTurnsForVerification: 3,
  resetOnVerification: true,
};

export interface VerificationOutcome {
  isError?: boolean;
  result?: unknown;
}

export interface VerificationRecord {
  toolName: string;
  command?: string;
  success: boolean;
  exitCode?: number | null;
  status?: string;
  timedOut?: boolean;
}

export interface SelfVerifyState {
  hasUnverifiedEdits: boolean;
  changedFiles: string[];
  diffReviewed: boolean;
  verificationAttempted: boolean;
  lastVerificationFailed: boolean;
  lastVerification?: VerificationRecord;
  lastMutationTool?: string;
}

export type SelfVerifyAgentKind = 'coder' | 'data' | 'writer' | 'researcher' | 'creative' | 'generic';

interface SelfVerifyTrackerState {
  fileEdits: Map<string, FileEditRecord>;
  turnCount: number;
  verificationRequested: boolean;
  hasUnverifiedEdits: boolean;
  diffReviewed: boolean;
  lastVerification: VerificationRecord | undefined;
  lastMutationTool: string | undefined;
}

function createTrackerState(): SelfVerifyTrackerState {
  return {
    fileEdits: new Map(),
    turnCount: 0,
    verificationRequested: false,
    hasUnverifiedEdits: false,
    diffReviewed: false,
    lastVerification: undefined,
    lastMutationTool: undefined,
  };
}

/**
 * Tracks file modifications and provides verification guidance
 */
export class SelfVerifyMiddleware {
  private readonly states = new Map<string, SelfVerifyTrackerState>();
  private config: SelfVerifyConfig;

  constructor(config: Partial<SelfVerifyConfig> = {}) {
    this.config = { ...DEFAULT_CONFIG, ...config };
  }

  private getState(sessionKey?: string): SelfVerifyTrackerState {
    const key = sessionKey ?? 'default';
    let state = this.states.get(key);
    if (!state) {
      state = createTrackerState();
      this.states.set(key, state);
    }
    return state;
  }

  /**
   * Record a file edit operation
   */
  recordEdit(filePath: string, operation: 'write' | 'edit' | 'command', sessionKey?: string): void {
    const state = this.getState(sessionKey);
    const now = Date.now();
    const existing = state.fileEdits.get(filePath);

    if (existing) {
      existing.editCount++;
      existing.lastEditTime = now;
      if (!existing.operations.includes(operation)) {
        existing.operations.push(operation);
      }
    } else {
      state.fileEdits.set(filePath, {
        path: filePath,
        editCount: 1,
        lastEditTime: now,
        operations: [operation],
      });
    }

    state.hasUnverifiedEdits = true;
    state.diffReviewed = false;
    state.lastMutationTool = operation;
    log.debug({ filePath, editCount: this.getEditCount(filePath, sessionKey), operation }, 'File edit recorded');
  }

  recordVerification(toolName: string, args?: unknown, outcome?: VerificationOutcome, sessionKey?: string): void {
    const state = this.getState(sessionKey);
    const name = toolName.toLowerCase();
    if (name === 'exec_command') {
      const command = this.extractExecCommand(args, outcome?.result);
      const success = this.isSuccessfulExecVerification(outcome);
      const details = this.extractResultDetails(outcome?.result);

      if (success && this.isDiffReviewCommand(command)) {
        state.diffReviewed = true;
        return;
      }

      if (!this.isVerificationCommand(command)) {
        return;
      }

      const rawExitCode = details?.exitCode;
      let exitCode: number | null | undefined;
      if (typeof rawExitCode === 'number') {
        exitCode = rawExitCode;
      } else if (rawExitCode === null) {
        exitCode = null;
      }
      state.lastVerification = {
        toolName,
        command,
        success,
        exitCode,
        status: typeof details?.status === 'string' ? details.status : undefined,
        timedOut: details?.timedOut === true,
      };

      if (success) {
        state.hasUnverifiedEdits = false;
      }
      return;
    }
    if (name.includes('test') || name.includes('verify') || name.includes('lint')) {
      state.hasUnverifiedEdits = false;
      state.lastVerification = { toolName, success: true };
    }
  }

  getVerificationState(sessionKey?: string): SelfVerifyState {
    const state = this.getState(sessionKey);
    const changedFiles = Array.from(state.fileEdits.keys()).sort();
    const lastVerification = state.lastVerification
      ? { ...state.lastVerification }
      : undefined;
    return {
      hasUnverifiedEdits: state.hasUnverifiedEdits,
      changedFiles,
      diffReviewed: state.diffReviewed,
      verificationAttempted: Boolean(lastVerification),
      lastVerificationFailed: Boolean(lastVerification && !lastVerification.success),
      lastVerification,
      lastMutationTool: state.lastMutationTool,
    };
  }

  getPendingVerificationContext(sessionKey?: string, agentId?: string): string {
    const state = this.getState(sessionKey);
    if (!this.config.enablePreCompletionCheck || !state.hasUnverifiedEdits) {
      return '';
    }
    return this.buildPendingVerificationReminder(sessionKey, agentId);
  }

  private extractExecCommand(args?: unknown, result?: unknown): string {
    if (args && typeof args === 'object') {
      const rec = args as { cmd?: unknown; command?: unknown };
      if (typeof rec.cmd === 'string') return rec.cmd.toLowerCase();
      if (typeof rec.command === 'string') return rec.command.toLowerCase();
    }

    const details = this.extractResultDetails(result);
    if (details) {
      const command = details.command;
      if (typeof command === 'string') return command.toLowerCase();
    }
    return '';
  }

  private extractResultDetails(result: unknown): Record<string, unknown> | null {
    if (!result || typeof result !== 'object') return null;
    const details = (result as { details?: unknown }).details;
    return details && typeof details === 'object'
      ? (details as Record<string, unknown>)
      : null;
  }

  private isSuccessfulExecVerification(outcome?: VerificationOutcome): boolean {
    if (!outcome || outcome.isError) return false;
    const details = this.extractResultDetails(outcome.result);
    if (!details) return false;
    if (details.timedOut === true) return false;
    if (details.status === 'success') return true;
    return details.exitCode === 0;
  }

  private isVerificationCommand(command: string): boolean {
    return /\b(test|vitest|jest|mocha|ava|playwright|typecheck|type-check|tsc|build|lint)\b/.test(command);
  }

  private isDiffReviewCommand(command: string): boolean {
    return /\bgit\s+(diff|status)\b/.test(command);
  }

  /**
   * Get edit count for a specific file
   */
  getEditCount(filePath: string, sessionKey?: string): number {
    return this.getState(sessionKey).fileEdits.get(filePath)?.editCount || 0;
  }

  /**
   * Check if any file has excessive edits (potential doom loop)
   */
  hasExcessiveEdits(sessionKey?: string): { file: string; count: number } | null {
    for (const [path, record] of this.getState(sessionKey).fileEdits.entries()) {
      if (record.editCount >= this.config.maxEditsPerFile) {
        return { file: path, count: record.editCount };
      }
    }
    return null;
  }

  /**
   * Increment turn counter
   */
  onTurnStart(sessionKey?: string): void {
    const state = this.getState(sessionKey);
    state.turnCount++;
    state.verificationRequested = false;
  }

  /**
   * Reset all tracking (e.g., after successful task completion)
   */
  reset(sessionKey?: string): void {
    if (sessionKey) {
      this.states.set(sessionKey, createTrackerState());
    } else {
      this.states.clear();
    }
    log.debug('Self-verify middleware reset');
  }

  consumePostEditReminder(sessionKey?: string): string {
    const state = this.getState(sessionKey);
    if (!this.config.enablePreCompletionCheck || !state.hasUnverifiedEdits) {
      return '';
    }
    if (state.verificationRequested) {
      return '';
    }
    state.verificationRequested = true;
    return this.buildPendingVerificationReminder(sessionKey);
  }

  /**
   * Get context injection for system prompt
   * Adds verification guidance based on current state
   */
  getContextInjection(sessionKey?: string, agentId?: string): string {
    const sections: string[] = [];

    // Add workflow guidance
    sections.push(this.buildWorkflowGuidance());

    // Add excessive edit warning if needed
    const excessive = this.hasExcessiveEdits(sessionKey);
    if (excessive) {
      sections.push(this.buildExcessiveEditWarning(excessive.file, excessive.count));
    }

    // Add pre-completion check reminder for long sessions
    if (this.shouldPromptForVerification(sessionKey)) {
      sections.push(this.buildPreCompletionReminder(sessionKey));
    }

    const pending = this.getPendingVerificationContext(sessionKey, agentId);
    if (pending) {
      sections.push(pending);
    }

    return sections.filter(Boolean).join('\n\n');
  }

  /**
   * Check if we should inject verification reminder
   */
  private shouldPromptForVerification(sessionKey?: string): boolean {
    const state = this.getState(sessionKey);
    if (!this.config.enablePreCompletionCheck) return false;
    if (state.turnCount < this.config.minTurnsForVerification) return false;
    if (state.verificationRequested) return false;
    return true;
  }

  /**
   * Mark verification as requested (to avoid spam)
   */
  markVerificationRequested(sessionKey?: string): void {
    this.getState(sessionKey).verificationRequested = true;
  }

  /**
   * Build workflow guidance section
   */
  private buildWorkflowGuidance(): string {
    return `## Problem Solving Workflow

Follow this iterative process for all tasks:

1. **Plan**: Understand the task, read relevant files, and create a plan
2. **Build**: Implement your solution with verification in mind
3. **Verify**: Test your work, run checks, compare against requirements
4. **Fix**: If issues found, analyze and fix them

**Important**: Before declaring a task complete:
- Re-read the original requirements
- Verify your solution meets ALL requirements
- Run any available tests or validation
- Check for edge cases

Do not skip verification. Incomplete verification leads to incorrect solutions.`;
  }

  private classifyAgent(agentId?: string): SelfVerifyAgentKind {
    const id = agentId?.trim().toLowerCase() ?? '';
    if (!id) return 'generic';
    if (id.includes('coder') || id.includes('code') || id.includes('developer')) return 'coder';
    if (id.includes('data') || id.includes('analyst') || id.includes('analysis')) return 'data';
    if (id.includes('writer') || id.includes('writing')) return 'writer';
    if (id.includes('research')) return 'researcher';
    if (id.includes('creative') || id.includes('design')) return 'creative';
    return 'generic';
  }

  private buildPendingVerificationReminder(sessionKey?: string, agentId?: string): string {
    const state = this.getVerificationState(sessionKey);
    const kind = this.classifyAgent(agentId);
    const files = state.changedFiles.length > 0
      ? state.changedFiles.slice(0, 12).join(', ')
      : '(unknown files)';
    const extraFiles = state.changedFiles.length > 12
      ? `, and ${state.changedFiles.length - 12} more`
      : '';
    const profile = this.verificationProfile(kind);
    const lines = [
      `## ${profile.title}`,
      profile.checkLine,
      `${profile.changedLabel}: ${files}${extraFiles}.`,
      state.diffReviewed
        ? 'Diff review: completed with git diff/status.'
        : 'Diff review: not recorded yet.',
    ];

    if (state.lastVerification) {
      const command = state.lastVerification.command
        ? ` (${state.lastVerification.command})`
        : '';
      lines.push(
        state.lastVerification.success
          ? `Last verification: passed${command}.`
          : `Last verification: failed${command}.`,
      );
    } else {
      lines.push('Last verification: none recorded.');
    }

    lines.push(profile.finalGuidance);
    return lines.join('\n');
  }

  private verificationProfile(kind: SelfVerifyAgentKind): {
    title: string;
    checkLine: string;
    changedLabel: string;
    finalGuidance: string;
  } {
    switch (kind) {
      case 'coder':
        return {
          title: 'Coder Verification State',
          checkLine: 'Coder check: source files changed.',
          changedLabel: 'Changed source files',
          finalGuidance:
            'Before final response, inspect the diff and run the smallest meaningful code verification, such as a targeted test, typecheck, lint, or build. If verification cannot run, final response must state why and name the remaining risk.',
        };
      case 'data':
        return {
          title: 'Data Verification State',
          checkLine: 'Data check: analysis files or outputs changed.',
          changedLabel: 'Changed files or artifacts',
          finalGuidance:
            'Before final response, inspect the diff or generated outputs and run the smallest meaningful data validation, such as rerunning the analysis, checking row counts, schemas, filters, joins, units, or output files. If validation cannot run, final response must state why and name the remaining risk.',
        };
      case 'writer':
        return {
          title: 'Writing Review State',
          checkLine: 'Writing check: draft or document files changed.',
          changedLabel: 'Changed files or artifacts',
          finalGuidance:
            'Before final response, inspect the changed artifact for requested content, structure, formatting, placeholders, and obvious inconsistencies. If a review cannot be completed, final response must state why and name the remaining risk.',
        };
      case 'researcher':
        return {
          title: 'Research Review State',
          checkLine: 'Research check: research notes or report files changed.',
          changedLabel: 'Changed files or artifacts',
          finalGuidance:
            'Before final response, inspect the changed artifact and verify citations, source-backed claims, unresolved uncertainty, and formatting. If source or artifact review cannot be completed, final response must state why and name the remaining risk.',
        };
      case 'creative':
        return {
          title: 'Creative Review State',
          checkLine: 'Creative check: creative artifact files changed.',
          changedLabel: 'Changed files or artifacts',
          finalGuidance:
            'Before final response, inspect the changed artifact against the brief, requested format, visual/text quality, and any saved outputs. If review cannot be completed, final response must state why and name the remaining risk.',
        };
      case 'generic':
      default:
        return {
          title: 'Workspace Verification State',
          checkLine: 'Workspace check: files changed.',
          changedLabel: 'Changed files or artifacts',
          finalGuidance:
            'Before final response, inspect the changed files and run the smallest meaningful verification for this task. If verification cannot run, final response must state why and name the remaining risk.',
        };
    }
  }

  /**
   * Build warning for excessive file edits (doom loop detection)
   */
  private buildExcessiveEditWarning(filePath: string, count: number): string {
    return `⚠️ **Pattern Alert**: You have edited "${filePath}" ${count} times.

This may indicate:
- You're fixing symptoms rather than root causes
- The approach needs reconsideration
- Requirements may be unclear

**Recommendation**: 
- Step back and re-read the original task
- Consider if there's a better approach
- Verify you understand the requirements correctly`;
  }

  /**
   * Build pre-completion verification reminder
   */
  private buildPreCompletionReminder(sessionKey?: string): string {
    const state = this.getState(sessionKey);
    this.markVerificationRequested(sessionKey);
    return `⏳ **Verification Check**: You've made ${state.turnCount} turns on this task.

Before completing:
1. ✅ Verify your solution matches the original requirements
2. ✅ Run tests or validation if available
3. ✅ Check edge cases and error handling
4. ✅ Review your changes one final time

If you're confident, proceed. If unsure, continue refining.`;
  }

  /**
   * Get summary of file edits for debugging
   */
  getEditSummary(sessionKey?: string): { totalFiles: number; totalEdits: number; topFiles: Array<{ path: string; count: number }> } {
    const entries = Array.from(this.getState(sessionKey).fileEdits.entries());
    const totalEdits = entries.reduce((sum, [, record]) => sum + record.editCount, 0);
    const topFiles = entries
      .sort((a, b) => b[1].editCount - a[1].editCount)
      .slice(0, 5)
      .map(([path, record]) => ({ path, count: record.editCount }));

    return {
      totalFiles: entries.length,
      totalEdits,
      topFiles,
    };
  }

  /**
   * Update configuration
   */
  setConfig(config: Partial<SelfVerifyConfig>): void {
    this.config = { ...this.config, ...config };
  }

  /**
   * Get current configuration
   */
  getConfig(): SelfVerifyConfig {
    return { ...this.config };
  }
}
