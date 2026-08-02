import { afterEach, describe, expect, it } from 'vitest';

import {
  createComposerAttachmentHandoff,
  resetComposerAttachmentHandoffsForTests,
  takeComposerAttachmentHandoff,
} from '@/features/chat/composer/composer-attachment-handoff';

describe('composer attachment handoff', () => {
  afterEach(() => resetComposerAttachmentHandoffsForTests());

  it('hands a file to the composer exactly once', () => {
    const file = new File(['hello'], 'notes.txt', { type: 'text/plain' });
    const id = createComposerAttachmentHandoff(file, 1_000);

    expect(takeComposerAttachmentHandoff(id, 1_001)).toBe(file);
    expect(takeComposerAttachmentHandoff(id, 1_002)).toBeNull();
  });

  it('drops an expired handoff', () => {
    const file = new File(['hello'], 'notes.txt', { type: 'text/plain' });
    const id = createComposerAttachmentHandoff(file, 1_000);

    expect(takeComposerAttachmentHandoff(id, 121_000)).toBeNull();
  });
});
