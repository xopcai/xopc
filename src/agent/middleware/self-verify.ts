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
  operations: string[]; // 'write', 'edit', 'shell' (for build commands)
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

/**
 * Tracks file modifications and provides verification guidance
 */
export class SelfVerifyMiddleware {
  private fileEdits: Map<string, FileEditRecord> = new Map();
  private config: SelfVerifyConfig;
  private turnCount = 0;
  private verificationRequested = false;
  private lastVerificationPrompt = '';

  constructor(config: Partial<SelfVerifyConfig> = {}) {
    this.config = { ...DEFAULT_CONFIG, ...config };
  }

  /**
   * Record a file edit operation
   */
  recordEdit(filePath: string, operation: 'write' | 'edit' | 'shell'): void {
    const now = Date.now();
    const existing = this.fileEdits.get(filePath);

    if (existing) {
      existing.editCount++;
      existing.lastEditTime = now;
      if (!existing.operations.includes(operation)) {
        existing.operations.push(operation);
      }
    } else {
      this.fileEdits.set(filePath, {
        path: filePath,
        editCount: 1,
        lastEditTime: now,
        operations: [operation],
      });
    }

    log.debug({ filePath, editCount: this.getEditCount(filePath), operation }, 'File edit recorded');
  }

  /**
   * Get edit count for a specific file
   */
  getEditCount(filePath: string): number {
    return this.fileEdits.get(filePath)?.editCount || 0;
  }

  /**
   * Check if any file has excessive edits (potential doom loop)
   */
  hasExcessiveEdits(): { file: string; count: number } | null {
    for (const [path, record] of this.fileEdits.entries()) {
      if (record.editCount >= this.config.maxEditsPerFile) {
        return { file: path, count: record.editCount };
      }
    }
    return null;
  }

  /**
   * Increment turn counter
   */
  onTurnStart(): void {
    this.turnCount++;
    this.verificationRequested = false;
  }

  /**
   * Reset all tracking (e.g., after successful task completion)
   */
  reset(): void {
    this.fileEdits.clear();
    this.turnCount = 0;
    this.verificationRequested = false;
    this.lastVerificationPrompt = '';
    log.debug('Self-verify middleware reset');
  }

  /**
   * Get context injection for system prompt
   * Adds verification guidance based on current state
   */
  getContextInjection(): string {
    const sections: string[] = [];

    // Add workflow guidance
    sections.push(this.buildWorkflowGuidance());

    // Add excessive edit warning if needed
    const excessive = this.hasExcessiveEdits();
    if (excessive) {
      sections.push(this.buildExcessiveEditWarning(excessive.file, excessive.count));
    }

    // Add pre-completion check reminder for long sessions
    if (this.shouldPromptForVerification()) {
      sections.push(this.buildPreCompletionReminder());
    }

    return sections.filter(Boolean).join('\n\n');
  }

  /**
   * Check if we should inject verification reminder
   */
  private shouldPromptForVerification(): boolean {
    if (!this.config.enablePreCompletionCheck) return false;
    if (this.turnCount < this.config.minTurnsForVerification) return false;
    if (this.verificationRequested) return false;
    return true;
  }

  /**
   * Mark verification as requested (to avoid spam)
   */
  markVerificationRequested(): void {
    this.verificationRequested = true;
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
  private buildPreCompletionReminder(): string {
    this.markVerificationRequested();
    return `⏳ **Verification Check**: You've made ${this.turnCount} turns on this task.

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
  getEditSummary(): { totalFiles: number; totalEdits: number; topFiles: Array<{ path: string; count: number }> } {
    const entries = Array.from(this.fileEdits.entries());
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
