import type { AgentMessage } from '@earendil-works/pi-agent-core';
import { describe, expect, it } from 'vitest';

import { projectWorkEvidence } from '../projectEvidence.js';

const large = Array.from({ length: 80 }, (_, index) => `Stable source line ${index}: 保留完整事实 🌲`).join('\n');
const review = (id: string, text: string, revision = id): AgentMessage => ({
  role: 'toolResult', toolName: 'review_workspace', toolCallId: id, content: [{ type: 'text', text }],
  isError: false, timestamp: 0, details: { complete: true, workspaceRevision: revision, verification: { status: 'passed' } },
});
const read = (id: string, text = large): AgentMessage => ({
  role: 'toolResult', toolName: 'read_file', toolCallId: id, content: [{ type: 'text', text }],
  isError: false, timestamp: 0, details: { path: '/workspace/source.md', offset: 1, totalLines: 80, truncated: false },
});

describe('workspace evidence projection', () => {
  it('shares unchanged review lines while preserving differing historical evidence and the full latest review', () => {
    const older = review('old', `${large}\nOld calculation\n${large}`);
    const latest = review('latest', `${large}\nNew calculation\n${large}`);
    const original = structuredClone([older, latest]);
    const result = projectWorkEvidence([older, latest]);
    expect(result.sharedReviews).toBe(1);
    expect(result.savedChars).toBeGreaterThan(large.length);
    expect(result.messages[0]).toMatchObject({ toolCallId: 'old', content: [{ text: expect.stringContaining('Old calculation') }] });
    expect(JSON.stringify(result.messages[0])).toContain('last complete review in this user turn (original receipt latest)');
    expect(JSON.stringify(result.messages[0])).toContain('first 80 lines and last 80 lines');
    const latestLines = `${large}\nNew calculation\n${large}`.split('\n');
    expect([...latestLines.slice(0, 80), 'Old calculation', ...latestLines.slice(-80)].join('\n')).toBe(`${large}\nOld calculation\n${large}`);
    expect(result.messages[1]).toEqual(latest);
    expect([older, latest]).toEqual(original);
  });

  it('shares only identical complete reads, keeping changed inputs and tool identities intact', () => {
    const input = [read('first'), read('changed', `${large}\nnew fact`), read('repeat')];
    const result = projectWorkEvidence(input);
    expect(result.sharedReads).toBe(1);
    expect(result.messages[0]).toMatchObject({ toolCallId: 'first', content: [{ text: expect.stringContaining('original receipt repeat') }] });
    expect(result.messages.slice(1)).toEqual(input.slice(1));
  });

  it('preserves failures, incomplete reviews, excerpts and separate user-turn baselines', () => {
    const incomplete = { ...review('incomplete', large), details: { complete: false } } as AgentMessage;
    const failed = { ...review('failed', large), isError: true } as AgentMessage;
    const excerpt = { ...read('excerpt'), details: { path: '/workspace/source.md', truncated: true } } as AgentMessage;
    const user: AgentMessage = { role: 'user', content: 'Compare the earlier result with the new scope.', timestamp: 1 };
    const input = [review('baseline', large), read('baseline-read'), user, incomplete, failed, excerpt, review('last', large), read('last-read')];
    expect(projectWorkEvidence(input).messages).toEqual(input);
  });

  it('does not alter command receipts, mixed media, or small reviews', () => {
    const command = { ...read('command'), toolName: 'exec_command' } as AgentMessage;
    const image = { ...read('image'), content: [{ type: 'image', data: 'pixels', mimeType: 'image/png' }] } as AgentMessage;
    const input = [command, command, image, read('last-read'), review('small', 'old'), review('new', 'new')];
    expect(projectWorkEvidence(input).messages).toEqual(input);
  });
});
