import { mkdtempSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, expect, it } from 'vitest';

import { actionApprovalKey, requiresActionApproval } from '../action-policy.js';

let workspace: string;
beforeEach(() => { workspace = mkdtempSync(join(tmpdir(), 'xopc-action-policy-')); writeFileSync(join(workspace, 'note.md'), 'hello'); });
afterEach(() => rmSync(workspace, { recursive: true, force: true }));
const needs = (name: string, args: unknown, core = true) => requiresActionApproval({ name, args, core, workspace, mode: 'ask' });

it('allows trusted local reads but asks for unknown tools, network and shell including test runners', () => {
  expect(needs('read_file', { path: 'note.md' })).toBe(false);
  expect(needs('read_file', { path: 'note.md' }, false)).toBe(true);
  expect(needs('web_fetch', { url: 'https://example.com' })).toBe(true);
  expect(needs('exec_command', { cmd: 'pnpm test' })).toBe(true);
  expect(needs('mcp__mail__send', { readOnlyHint: true })).toBe(true);
});
it('asks for a symlink escaping the canonical workspace and for destructive patches', () => {
  symlinkSync(tmpdir(), join(workspace, 'outside'));
  expect(needs('list_dir', { path: 'outside' })).toBe(true);
  expect(needs('apply_patch', { patch: '*** Begin Patch\n*** Delete File: note.md\n*** End Patch' })).toBe(true);
  expect(needs('apply_patch', { patch: '*** Begin Patch\n*** Add File: new.md\n+hello\n*** End Patch' })).toBe(false);
});
it('checks a complete data batch before any of its reads execute', () => {
  expect(needs('data_batch', { operations: [{ id: 'local', kind: 'file_read', path: 'note.md' }] })).toBe(false);
  expect(needs('data_batch', { operations: [{ id: 'local', kind: 'file_read', path: 'note.md' }, { id: 'web', kind: 'web_search', query: 'hello' }] })).toBe(true);
});
it('full skips ordinary prompts but preserves explicit ask', () => {
  const input = { name: 'exec_command', args: {}, workspace, core: true, mode: 'full' as const };
  expect(requiresActionApproval(input)).toBe(false);
  expect(requiresActionApproval({ ...input, policy: { mode: 'ask' } })).toBe(true);
});
it('binds the complete canonical arguments, policy, account and workspace', () => {
  const base = { toolName: 'send', args: { body: 'hello', account: 'work' }, workspace, mode: 'ask' as const, agentId: 'main', policy: {} };
  expect(actionApprovalKey(base)).toBe(actionApprovalKey({ ...base, args: { account: 'work', body: 'hello' } }));
  expect(actionApprovalKey(base)).not.toBe(actionApprovalKey({ ...base, args: { body: 'hello', account: 'personal' } }));
  expect(actionApprovalKey(base)).not.toBe(actionApprovalKey({ ...base, workspace: tmpdir() }));
  expect(actionApprovalKey(base)).not.toBe(actionApprovalKey({ ...base, policy: { send: { mode: 'deny' } } }));
});
