import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { describe, expect, it, afterEach } from 'vitest';

import { MemoryFlushService } from '../memory-flush.js';
import type { CompactionResult } from '../compaction.js';

describe('MemoryFlushService', () => {
  let dir: string;
  const service = new MemoryFlushService();

  afterEach(() => {
    if (dir) {
      try {
        rmSync(dir, { recursive: true, force: true });
      } catch {
        /* ignore */
      }
    }
  });

  const baseConfig = {
    enabled: true,
    threshold: 0.88,
    softThresholdTokens: 4000,
    afterCompactions: 2,
    maxEntryChars: 2000,
    includeToolHistory: true,
  };

  const baseCompaction: CompactionResult = {
    summary: 'Test summary',
    firstKeptIndex: 2,
    tokensBefore: 10000,
    tokensAfter: 5000,
    compacted: true,
    structuredSummary: {
      userRequests: ['Implement feature X'],
      toolCalls: [
        { toolName: 'write_file', filePath: '/src/x.ts', operation: 'write', success: true },
        { toolName: 'read_file', filePath: '/src/y.ts', operation: 'read', success: true },
      ],
      keyDecisions: ['Use approach A'],
      filesModified: ['/src/x.ts'],
      totalToolCalls: 2,
      successfulToolCalls: 2,
      failedToolCalls: 0,
    },
  };

  const readFlushFile = (workspaceDir: string, result: { entryPath: string }): string => {
    return readFileSync(join(workspaceDir, result.entryPath), 'utf-8');
  };

  it('returns not flushed when disabled', async () => {
    const result = await service.flush({
      workspaceDir: '/tmp',
      sessionKey: 'test',
      compactionResult: baseCompaction,
      config: { ...baseConfig, enabled: false },
    });
    expect(result.flushed).toBe(false);
    expect(result.reason).toBe('disabled');
  });

  it('writes to new daily notes file', async () => {
    dir = mkdtempSync(join(tmpdir(), 'xopc-flush-'));
    const result = await service.flush({
      workspaceDir: dir,
      sessionKey: 'agent:main:webchat:default:direct:test',
      compactionResult: baseCompaction,
      config: baseConfig,
    });

    expect(result.flushed).toBe(true);
    expect(result.entryPath).toMatch(/^memory\/\d{4}-\d{2}-\d{2}\.md$/);
    expect(result.entryLength).toBeGreaterThan(0);

    const memoryDir = join(dir, 'memory');
    const files = readFileSync(join(memoryDir, result.entryPath.replace('memory/', '')), 'utf-8');
    expect(files).toContain('# Daily Notes');
    expect(files).toContain('## Session Flush [agent:main:webchat:default:direct:test]');
    expect(files).toContain('**Summary:** Test summary');
    expect(files).toContain('**User Requests:**');
    expect(files).toContain('- Implement feature X');
    expect(files).toContain('**Key Decisions:**');
    expect(files).toContain('- Use approach A');
    expect(files).toContain('**Files Modified:**');
    expect(files).toContain('- /src/x.ts');
    expect(files).toContain('**Tool Calls:**');
    expect(files).toContain('`write_file` (/src/x.ts) — success');
    expect(files).toContain('---');
  });

  it('appends to existing daily notes file', async () => {
    dir = mkdtempSync(join(tmpdir(), 'xopc-flush-'));
    const memoryDir = join(dir, 'memory');
    mkdirSync(memoryDir, { recursive: true });
    const day = new Intl.DateTimeFormat('en-CA').format(new Date());
    writeFileSync(join(memoryDir, `${day}.md`), '# Daily Notes — existing\n\nExisting content.\n', 'utf-8');

    const result = await service.flush({
      workspaceDir: dir,
      sessionKey: 'agent:main:webchat:default:direct:test2',
      compactionResult: baseCompaction,
      config: baseConfig,
    });

    expect(result.flushed).toBe(true);

    const content = readFlushFile(dir, result);
    expect(content).toContain('Existing content.');
    expect(content).toContain('## Session Flush [agent:main:webchat:default:direct:test2]');
  });

  it('excludes tool history when includeToolHistory is false', async () => {
    dir = mkdtempSync(join(tmpdir(), 'xopc-flush-'));
    const result = await service.flush({
      workspaceDir: dir,
      sessionKey: 'test',
      compactionResult: baseCompaction,
      config: { ...baseConfig, includeToolHistory: false },
    });

    expect(result.flushed).toBe(true);

    const content = readFlushFile(dir, result);
    expect(content).not.toContain('**Tool Calls:**');
    expect(content).toContain('**User Requests:**');
  });

  it('truncates when entry exceeds maxEntryChars', async () => {
    dir = mkdtempSync(join(tmpdir(), 'xopc-flush-'));
    const longCompaction: CompactionResult = {
      ...baseCompaction,
      summary: 'A'.repeat(3000),
    };

    const result = await service.flush({
      workspaceDir: dir,
      sessionKey: 'test',
      compactionResult: longCompaction,
      config: { ...baseConfig, maxEntryChars: 500 },
    });

    expect(result.flushed).toBe(true);

    const content = readFlushFile(dir, result);
    expect(content).toContain('Entry truncated due to length limit');
    expect(content.length).toBeLessThanOrEqual(550); // allow small overhead
  });

  it('falls back to plain summary when structuredSummary is absent', async () => {
    dir = mkdtempSync(join(tmpdir(), 'xopc-flush-'));
    const compaction: CompactionResult = {
      summary: 'Plain text summary only',
      firstKeptIndex: 0,
      tokensBefore: 100,
      tokensAfter: 50,
      compacted: true,
    };

    const result = await service.flush({
      workspaceDir: dir,
      sessionKey: 'test',
      compactionResult: compaction,
      config: baseConfig,
    });

    expect(result.flushed).toBe(true);

    const content = readFlushFile(dir, result);
    expect(content).toContain('**Summary (text only):**');
    expect(content).toContain('Plain text summary only');
    expect(content).not.toContain('**User Requests:**');
  });
});
