import { describe, expect, it } from 'vitest';

import {
  sessionInputFingerprint,
  shouldRetrySessionInputStatus,
} from './session-input-reliability.js';

describe('session input reliability', () => {
  it('creates a stable fingerprint and includes attachments', () => {
    const first = sessionInputFingerprint({ content: 'hello', attachments: [{ name: 'a.txt', data: 'a' }] });
    const same = sessionInputFingerprint({ content: 'hello', attachments: [{ name: 'a.txt', data: 'a' }] });
    const changed = sessionInputFingerprint({ content: 'hello', attachments: [{ name: 'a.txt', data: 'b' }] });
    expect(same).toBe(first);
    expect(changed).not.toBe(first);
  });

  it('includes message context references', () => {
    const plain = sessionInputFingerprint({ content: 'hello' });
    const withNote = sessionInputFingerprint({
      content: 'hello',
      contextRefs: [{ kind: 'note', sourceId: 'note-1', expectedVersion: '42' }],
    });
    expect(withNote).not.toBe(plain);
  });

  it('includes frozen browser context', () => {
    const first = sessionInputFingerprint({ content: 'hello', browserContexts: [{ version: 'one' }] });
    const changed = sessionInputFingerprint({ content: 'hello', browserContexts: [{ version: 'two' }] });
    expect(first).not.toBe(changed);
  });

  it('retries only transient HTTP statuses', () => {
    expect(shouldRetrySessionInputStatus(408)).toBe(true);
    expect(shouldRetrySessionInputStatus(429)).toBe(true);
    expect(shouldRetrySessionInputStatus(503)).toBe(true);
    expect(shouldRetrySessionInputStatus(400)).toBe(false);
    expect(shouldRetrySessionInputStatus(401)).toBe(false);
  });

  it('includes captured page identity, revisions and unsaved selections', () => {
    const appContext = {
      version: 1 as const, clientInstanceId: '7ff7f7a3-463c-4d2c-8a9f-d90c43424f60',
      tabId: '19979ed2-81e0-4c80-9a81-ccbb8fb0061c', sequence: 1,
      surface: 'web' as const, resourceRefs: [{ kind: 'note' as const, id: 'one', revision: '1' }],
      capturedAt: 12, selection: { text: 'Draft', draft: true },
    };
    const fingerprint = sessionInputFingerprint({ content: 'Review', appContext });
    expect(sessionInputFingerprint({ content: 'Review', appContext: structuredClone(appContext) })).toBe(fingerprint);
    for (const changed of [
      { ...appContext, sequence: 2 },
      { ...appContext, tabId: 'another-tab' },
      { ...appContext, resourceRefs: [{ ...appContext.resourceRefs[0]!, revision: '2' }] },
      { ...appContext, selection: { text: 'Changed', draft: true } },
    ]) expect(sessionInputFingerprint({ content: 'Review', appContext: changed })).not.toBe(fingerprint);
    expect(sessionInputFingerprint({ content: 'Review', appContext: undefined }))
      .toBe(sessionInputFingerprint({ content: 'Review' }));
  });
});
