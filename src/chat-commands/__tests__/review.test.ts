import { execFileSync } from 'node:child_process';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import type { Config } from '../../config/schema.js';
import { commandRegistry } from '../registry.js';
import { registerReviewCommand } from '../builtins/review.js';
import type { CommandContext } from '../types.js';
import { buildReviewContext } from '../../review/review-git.js';

function git(cwd: string, args: string[]): void {
  execFileSync('git', args, { cwd, stdio: 'ignore' });
}

function createContext(
  root: string,
  btwQuery: CommandContext['btwQuery'],
  emitEvent?: CommandContext['emitEvent'],
): CommandContext {
  return {
    sessionKey: 'agent:main:webchat:review-test',
    source: 'webui',
    channelId: 'webchat',
    chatId: 'review-test',
    senderId: 'local-user',
    isGroup: false,
    config: {
      agents: {
        default: 'main',
        capabilityPresets: {},
        list: [
          {
            id: 'main',
            enabled: true,
            identity: { name: 'Main', role: 'Agent', language: 'en', tone: 'direct' },
            responsibilities: { primary: ['Review code'] },
            workspace: { root },
            models: { defaultRole: 'deep', roles: { deep: { model: 'openai/gpt-4.1' } } },
            tools: { builtin: {} },
            skills: { mode: 'all' },
            memory: { mode: 'off', sources: [], writePolicy: {} },
            workflows: {},
            boundaries: { requiresConfirmation: [], forbidden: [], escalation: [] },
          },
        ],
      },
      workspace: { root },
    } as Config,
    setTyping: vi.fn(async () => undefined),
    supports: () => false,
    btwQuery,
    emitEvent,
  } as unknown as CommandContext;
}

describe('/review command', () => {
  let repo: string;

  beforeEach(() => {
    commandRegistry.clear();
    registerReviewCommand();
    repo = mkdtempSync(join(tmpdir(), 'xopc-review-command-'));
    git(repo, ['init', '-b', 'main']);
    writeFileSync(join(repo, 'app.ts'), 'export const value = 1;\n');
    git(repo, ['add', 'app.ts']);
    git(repo, ['-c', 'user.email=test@example.com', '-c', 'user.name=Test', 'commit', '-m', 'init']);
  });

  afterEach(() => {
    commandRegistry.clear();
    rmSync(repo, { recursive: true, force: true });
  });

  it('returns structured review metadata from reviewer JSON', async () => {
    writeFileSync(join(repo, 'app.ts'), 'export const value = 2;\n');
    const btwQuery = vi.fn(async () => ({
      text: JSON.stringify({
        findings: [
          {
            title: 'Incorrect value',
            body: 'The changed constant breaks callers that expect 1.',
            priority: 1,
            confidence_score: 0.9,
            code_location: {
              file_path: 'app.ts',
              line_range: { start: 1, end: 1 },
            },
          },
        ],
        overall_correctness: 'patch is incorrect',
        overall_explanation: 'The patch changes behavior without updating callers.',
        overall_confidence_score: 0.8,
        summary: '1 high priority finding',
      }),
    }));

    const result = await commandRegistry.execute('review', createContext(repo, btwQuery), '');
    const review = result.metadata?.review as Record<string, unknown> | undefined;

    expect(result.success).toBe(true);
    expect(result.content).toContain('[P1] Incorrect value - app.ts:1');
    expect(review?.type).toBe('review');
    expect(review?.overallCorrectness).toBe('patch is incorrect');
    expect(Array.isArray(review?.findings)).toBe(true);
    expect(btwQuery).toHaveBeenCalledWith(expect.any(String), {
      maxTokens: 8192,
      temperature: 0.1,
      modelRef: 'openai/gpt-4.1',
    });
  });

  it('emits review trace tool events for streaming clients', async () => {
    writeFileSync(join(repo, 'app.ts'), 'export const value = 2;\n');
    const btwQuery = vi.fn(async () => ({
      text: JSON.stringify({
        findings: [],
        overall_correctness: 'patch is correct',
        overall_explanation: 'No correctness issues found.',
        overall_confidence_score: 0.7,
        summary: 'No findings',
      }),
    }));
    const emitEvent = vi.fn();

    const result = await commandRegistry.execute('review', createContext(repo, btwQuery, emitEvent), '');

    expect(result.success).toBe(true);
    expect(emitEvent).toHaveBeenCalledWith(expect.objectContaining({
      type: 'tool_execution_start',
      toolName: 'review.prepare_diff',
    }));
    expect(emitEvent).toHaveBeenCalledWith(expect.objectContaining({
      type: 'tool_execution_end',
      toolName: 'review.prepare_diff',
      isError: false,
    }));
    expect(emitEvent).toHaveBeenCalledWith(expect.objectContaining({
      type: 'tool_execution_start',
      toolName: 'review.model_judge',
      args: expect.objectContaining({ modelRef: 'openai/gpt-4.1' }),
    }));
    expect(emitEvent).toHaveBeenCalledWith(expect.objectContaining({
      type: 'tool_execution_end',
      toolName: 'review.model_judge',
      isError: false,
    }));
  });

  it('marks reviewer fallback as a failed judge trace instead of no findings', async () => {
    writeFileSync(join(repo, 'app.ts'), 'export const value = 2;\n');
    const btwQuery = vi.fn(async () => ({ text: 'not json' }));
    const emitEvent = vi.fn();

    const result = await commandRegistry.execute('review', createContext(repo, btwQuery, emitEvent), '');

    expect(result.success).toBe(true);
    expect(result.content).toContain('No model findings were produced.');
    expect(result.content).toContain('Reviewer model output could not be parsed');
    expect(result.content).not.toContain('No findings.');
    expect(emitEvent).toHaveBeenCalledWith(expect.objectContaining({
      type: 'tool_execution_end',
      toolName: 'review.model_judge',
      isError: true,
      result: expect.objectContaining({
        details: expect.objectContaining({
          fallback: true,
          reason: expect.stringContaining('could not be parsed'),
          responsePreview: 'not json',
        }),
      }),
    }));
  });

  it('includes untracked file contents in the reviewer prompt', async () => {
    writeFileSync(join(repo, 'new-file.ts'), 'export const created = true;\n');
    const btwQuery = vi.fn(async () => ({
      text: JSON.stringify({
        findings: [],
        overall_correctness: 'patch is correct',
        overall_explanation: 'No correctness issues found.',
        overall_confidence_score: 0.7,
        summary: 'No findings',
      }),
    }));

    const result = await commandRegistry.execute('review', createContext(repo, btwQuery), '');
    const prompt = btwQuery.mock.calls[0]?.[0] ?? '';

    expect(result.success).toBe(true);
    expect(prompt).toContain('?? new-file.ts');
    expect(prompt).toContain('diff --git');
    expect(prompt).toContain('new-file.ts');
    expect(prompt).toContain('+export const created = true;');
  });

  it('reviews changes against a base branch', async () => {
    git(repo, ['checkout', '-b', 'feature']);
    writeFileSync(join(repo, 'app.ts'), 'export const value = 3;\n');
    git(repo, ['add', 'app.ts']);
    git(repo, ['-c', 'user.email=test@example.com', '-c', 'user.name=Test', 'commit', '-m', 'feature change']);
    const btwQuery = vi.fn(async () => ({
      text: JSON.stringify({
        findings: [],
        overall_correctness: 'patch is correct',
        overall_explanation: 'No correctness issues found.',
        summary: 'No findings',
      }),
    }));

    const result = await commandRegistry.execute('review', createContext(repo, btwQuery), '--base main');
    const prompt = btwQuery.mock.calls[0]?.[0] ?? '';

    expect(result.success).toBe(true);
    expect(prompt).toContain('Target: changes against main');
    expect(prompt).toContain('-export const value = 1;');
    expect(prompt).toContain('+export const value = 3;');
  });

  it('reviews a selected commit', async () => {
    writeFileSync(join(repo, 'app.ts'), 'export const value = 4;\n');
    git(repo, ['add', 'app.ts']);
    git(repo, ['-c', 'user.email=test@example.com', '-c', 'user.name=Test', 'commit', '-m', 'change value']);
    const btwQuery = vi.fn(async () => ({
      text: JSON.stringify({
        findings: [],
        overall_correctness: 'patch is correct',
        overall_explanation: 'No correctness issues found.',
        summary: 'No findings',
      }),
    }));

    const result = await commandRegistry.execute('review', createContext(repo, btwQuery), '--commit HEAD');
    const prompt = btwQuery.mock.calls[0]?.[0] ?? '';

    expect(result.success).toBe(true);
    expect(prompt).toContain('Target: commit HEAD (change value)');
    expect(prompt).toContain('commit ');
    expect(prompt).toContain('+export const value = 4;');
  });

  it('fails clearly for an invalid commit target', async () => {
    const btwQuery = vi.fn(async () => ({ text: '{}' }));

    const result = await commandRegistry.execute('review', createContext(repo, btwQuery), '--commit not-a-sha');

    expect(result.success).toBe(false);
    expect(result.content).toContain('Error executing command');
    expect(btwQuery).not.toHaveBeenCalled();
  });

  it('builds review context for UI launchers', async () => {
    writeFileSync(join(repo, 'new-file.ts'), 'export const created = true;\n');
    const context = await buildReviewContext(repo);

    expect(context.status.untrackedFiles).toBe(1);
    expect(context.status.isClean).toBe(false);
    expect(context.branches.map((branch) => branch.name)).toContain('main');
    expect(context.commits[0]?.subject).toBe('init');
    expect(context.defaultBaseBranch).toBeDefined();
  });
});
