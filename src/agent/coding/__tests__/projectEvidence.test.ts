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

it('shares exact file echoes with retained successful write arguments without changing executed calls', () => {
  const call: AgentMessage = { role: 'assistant', content: [{ type: 'toolCall', id: 'write', name: 'write_file', arguments: { path: 'source.md', content: large } }],
    api: 'openai-completions', provider: 'openai', model: 'test', stopReason: 'toolUse', timestamp: 0,
    usage: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, totalTokens: 0, cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 } } };
  const receipt: AgentMessage = { role: 'toolResult', toolCallId: 'write', toolName: 'write_file', content: [{ type: 'text', text: 'Written' }], isError: false, timestamp: 0, details: { path: '/workspace/source.md' } };
  const inspection = review('review', `Workspace changes:\n\nUntracked file: source.md\n${large}\nUntracked file: other.md\nDifferent content`);
  const input = [call, receipt, read('readback'), inspection];
  const original = structuredClone(input);
  const projected = projectWorkEvidence(input);
  expect(projected.sharedReads).toBe(1);
  expect(projected.sharedReviews).toBe(1);
  expect(projected.savedChars).toBeGreaterThan(large.length);
  expect(projected.messages.slice(0, 2)).toEqual(input.slice(0, 2));
  const alias = { ...read('alias'), details: { path: '/private/workspace/source.md', offset: 1, truncated: false } } as AgentMessage;
  const aliasProjection = projectWorkEvidence([call, receipt, alias]);
  expect(aliasProjection.sharedReads).toBe(1);
  expect((aliasProjection.messages[2] as any).details).toEqual((alias as any).details);
  expect(JSON.stringify(projected.messages[2])).toContain('successful write_file call write, arguments.content');
  expect(JSON.stringify(projected.messages[3])).toContain('Different content');
  expect((projected.messages[3] as any).details).toEqual((inspection as any).details);
  expect(input).toEqual(original);
});

it('keeps different content, failed writes, truncated reads and incomplete reviews in full', () => {
  const call: AgentMessage = { role: 'assistant', content: [{ type: 'toolCall', id: 'write', name: 'write_file', arguments: { path: 'source.md', content: large } }],
    api: 'openai-completions', provider: 'openai', model: 'test', stopReason: 'toolUse', timestamp: 0,
    usage: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, totalTokens: 0, cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 } } };
  const failed: AgentMessage = { role: 'toolResult', toolCallId: 'write', toolName: 'write_file', content: [{ type: 'text', text: 'Blocked' }], isError: false, timestamp: 0, details: { path: '/workspace/source.md', status: 'blocked' } };
  expect(projectWorkEvidence([call, failed, read('after-failure')]).messages).toEqual([call, failed, read('after-failure')]);
  const success = { ...failed, details: { path: '/workspace/source.md' } } as AgentMessage;
  const excerpt = { ...read('excerpt'), details: { path: '/workspace/source.md', offset: 1, truncated: true } } as AgentMessage;
  const incomplete = { ...review('incomplete', `\nUntracked file: source.md\n${large}`), details: { complete: false } } as AgentMessage;
  const changed = read('different', large + '\nNew fact');
  const input = [call, success, excerpt, incomplete, changed];
  expect(projectWorkEvidence(input).messages).toEqual(input);
  expect(projectWorkEvidence([success, read('missing-call')]).messages).toEqual([success, read('missing-call')]);
});

it('losslessly shares historical write arguments with the full latest successful write', () => {
  const makeCall = (id: string, body: string): AgentMessage => ({ role: 'assistant', content: [{ type: 'toolCall', id, name: 'write_file', arguments: { path: 'source.md', content: body } }],
    api: 'openai-completions', provider: 'openai', model: 'test', stopReason: 'toolUse', timestamp: 0,
    usage: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, totalTokens: 0, cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 } } });
  const receipt = (id: string, isError = false): AgentMessage => ({ role: 'toolResult', toolCallId: id, toolName: 'write_file', content: [{ type: 'text', text: isError ? 'Failed' : 'Written' }], isError, timestamp: 0, details: { path: '/workspace/source.md' } });
  const older = `${large}\nOriginal requirement 🌲\r\n${large}\n`;
  const latest = `${large}\nRevised requirement 🌈\r\n${large}\n`;
  const input = [makeCall('old', older), receipt('old'), { role: 'user', content: 'Narrow the scope.', timestamp: 1 } as AgentMessage, makeCall('new', latest), receipt('new')];
  const original = structuredClone(input);
  const result = projectWorkEvidence(input);
  expect(result.sharedWriteArguments).toBe(1);
  const encoded = (result.messages[0] as any).content[0].arguments.content as string;
  const delta = JSON.parse(encoded.slice(encoded.indexOf('\n') + 1));
  const base = latest.split('\n');
  expect([...base.slice(0, delta.prefixLines), ...delta.middleLines, ...(delta.suffixLines ? base.slice(-delta.suffixLines) : [])].join('\n')).toBe(older);
  expect(delta.referenceToolCallId).toBe('new');
  expect(result.messages.slice(1)).toEqual(input.slice(1));
  expect(input).toEqual(original);
  const failed = [makeCall('old', older), receipt('old'), makeCall('failed', latest), receipt('failed', true)];
  expect(projectWorkEvidence(failed).messages).toEqual(failed);
});
