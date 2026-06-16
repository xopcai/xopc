import { existsSync } from 'node:fs';
import { mkdir, readFile, writeFile, appendFile } from 'node:fs/promises';
import { join } from 'node:path';
import { createLogger } from '../../utils/logger.js';
import type { CompactionResult } from './compaction.js';

const log = createLogger('MemoryFlush');

export interface MemoryFlushConfig {
  enabled: boolean;
  threshold: number;
  softThresholdTokens: number;
  afterCompactions: number;
  maxEntryChars: number;
  includeToolHistory: boolean;
}

export interface MemoryFlushOptions {
  workspaceDir: string;
  sessionKey: string;
  compactionResult: CompactionResult;
  config: MemoryFlushConfig;
}

export interface MemoryFlushResult {
  flushed: boolean;
  entryPath: string;
  entryLength: number;
  reason?: string;
}

export class MemoryFlushService {
  async flush(options: MemoryFlushOptions): Promise<MemoryFlushResult> {
    const { workspaceDir, sessionKey, compactionResult, config } = options;

    if (!config.enabled) {
      return { flushed: false, entryPath: '', entryLength: 0, reason: 'disabled' };
    }

    const now = new Date();
    const day = this.isoDay(now);
    const memoryDir = join(workspaceDir, 'memory');
    const filePath = join(memoryDir, `${day}.md`);
    const entryPath = `memory/${day}.md`;

    await mkdir(memoryDir, { recursive: true });

    const entry = this.buildEntry(sessionKey, compactionResult, now, config);
    const entryText = entry.text;
    const entryLength = entryText.length;

    if (entryLength > config.maxEntryChars) {
      log.warn({ sessionKey, entryLength, maxEntryChars: config.maxEntryChars }, 'Flush entry exceeds maxEntryChars; truncating');
    }

    try {
      const fileExists = existsSync(filePath);
      if (!fileExists) {
        const frontmatter = `# Daily Notes — ${day}\n\n`;
        await writeFile(filePath, frontmatter + entryText, 'utf-8');
      } else {
        const existing = await readFile(filePath, 'utf-8');
        // Warn if file is getting large (>50KB) but still append
        if (existing.length > 50_000) {
          log.warn({ sessionKey, filePath, size: existing.length }, 'Daily notes file is large; continuing append');
        }
        await appendFile(filePath, '\n' + entryText, 'utf-8');
      }

      log.info({ sessionKey, entryPath, entryLength }, 'Memory flushed to daily notes');
      return { flushed: true, entryPath, entryLength };
    } catch (err) {
      const em = err instanceof Error ? err.message : String(err);
      log.error({ sessionKey, err, filePath }, `Memory flush failed: ${em}`);
      return { flushed: false, entryPath, entryLength: 0, reason: `write_error: ${em}` };
    }
  }

  private buildEntry(
    sessionKey: string,
    result: CompactionResult,
    now: Date,
    config: MemoryFlushConfig,
  ): { text: string } {
    const iso = now.toISOString();
    const lines: string[] = [];

    lines.push(`## Session Flush [${sessionKey}] ${iso}`);
    lines.push('');

    const summary = result.summary || '';
    lines.push(`**Summary:** ${summary}`);
    lines.push('');

    const structured = result.structuredSummary;
    if (structured) {
      if (structured.userRequests && structured.userRequests.length > 0) {
        lines.push('**User Requests:**');
        for (const req of structured.userRequests) {
          lines.push(`- ${req}`);
        }
        lines.push('');
      }

      if (structured.keyDecisions && structured.keyDecisions.length > 0) {
        lines.push('**Key Decisions:**');
        for (const decision of structured.keyDecisions) {
          lines.push(`- ${decision}`);
        }
        lines.push('');
      }

      if (structured.filesModified && structured.filesModified.length > 0) {
        lines.push('**Files Modified:**');
        for (const file of structured.filesModified) {
          lines.push(`- ${file}`);
        }
        lines.push('');
      }

      if (config.includeToolHistory && structured.toolCalls && structured.toolCalls.length > 0) {
        lines.push('**Tool Calls:**');
        for (const call of structured.toolCalls) {
          const filePart = call.filePath ? ` (${call.filePath})` : '';
          const status = call.success ? 'success' : 'failed';
          lines.push(`- \`${call.toolName}\`${filePart} — ${status}`);
        }
        lines.push('');
      }
    } else if (summary) {
      // Fallback when structuredSummary is absent
      lines.push('**Summary (text only):**');
      lines.push(summary);
      lines.push('');
    }

    lines.push('---');

    let text = lines.join('\n');

    // Respect maxEntryChars by truncating from the end if needed
    if (text.length > config.maxEntryChars) {
      // Keep the header and a truncation notice
      const headerEnd = text.indexOf('\n\n') + 2;
      const header = text.slice(0, headerEnd);
      const remainingBudget = config.maxEntryChars - header.length - 60;
      const body = text.slice(headerEnd);
      const truncatedBody = body.slice(0, Math.max(0, remainingBudget));
      text = header + truncatedBody + '\n\n*(Entry truncated due to length limit)*\n---';
    }

    return { text };
  }

  /** YYYY-MM-DD in local time (for daily `memory/YYYY-MM-DD.md` names). */
  private isoDay(d: Date): string {
    const y = d.getFullYear();
    const m = String(d.getMonth() + 1).padStart(2, '0');
    const day = String(d.getDate()).padStart(2, '0');
    return `${y}-${m}-${day}`;
  }
}
