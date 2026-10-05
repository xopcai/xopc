import { describe, expect, it } from 'vitest';

import { sessionInputCommandSchema, sessionCommandIdentity } from './session-input-command.js';

const start = {
  kind: 'start' as const, clientMessageId: 'message-1',
  creation: { agentId: 'main', projectId: null, execution: null, temporary: false, model: 'test/model', thinkingLevel: 'off' },
  input: { content: 'hello' }, origin: { type: 'endpoint' as const, endpointId: 'tab-1', token: 'token' },
};

describe('session input commands', () => {
  it('rejects old flat input and ambiguous first-input identity', () => {
    expect(sessionInputCommandSchema.safeParse({ content: 'hello', delivery: 'next', clientMessageId: '1' }).success).toBe(false);
    expect(sessionInputCommandSchema.safeParse({ ...start, expectedTranscriptId: 'invented' }).success).toBe(false);
    expect(sessionInputCommandSchema.safeParse(start).success).toBe(true);
  });
  it('requires transcript and configuration for append', () => {
    expect(sessionInputCommandSchema.safeParse({ kind: 'append', clientMessageId: '1', input: start.input, origin: start.origin, delivery: 'next' }).success).toBe(false);
  });
  it('preserves identity across reconnect but detects content and selection changes', () => {
    expect(sessionCommandIdentity({ ...start, origin: { ...start.origin, endpointId: 'reconnected', token: 'new' } })).toBe(sessionCommandIdentity(start));
    expect(sessionCommandIdentity({ ...start, input: { content: 'different' } })).not.toBe(sessionCommandIdentity(start));
    expect(sessionCommandIdentity({ ...start, creation: { ...start.creation, model: 'test/other' } })).not.toBe(sessionCommandIdentity(start));
  });
  it('rejects environment selection without a project', () => {
    expect(sessionInputCommandSchema.safeParse({ ...start, creation: { ...start.creation, execution: { mode: 'managed_worktree' } } }).success).toBe(false);
  });
});

describe('session input command references', () => {
  const base = {
    kind: 'start',
    clientMessageId: 'message-1',
    creation: { agentId: 'main', projectId: null, execution: null, temporary: false,
      model: 'test/model', thinkingLevel: 'off' },
    origin: { type: 'endpoint', endpointId: 'android-test', token: 'claim' },
  };

  it('accepts a versioned user assertion without display-only fields', () => {
    expect(sessionInputCommandSchema.safeParse({ ...base,
      input: { content: 'Update this understanding', contextRefs: [
        { kind: 'user_assertion', sourceId: 'assertion-1', expectedVersion: '123' },
      ] },
    }).success).toBe(true);
  });

  it('rejects display-only fields in the transmitted reference', () => {
    expect(sessionInputCommandSchema.safeParse({ ...base,
      input: { content: 'Update this understanding', contextRefs: [
        { kind: 'user_assertion', sourceId: 'assertion-1', expectedVersion: '123', title: 'Private text' },
      ] },
    }).success).toBe(false);
  });
});
