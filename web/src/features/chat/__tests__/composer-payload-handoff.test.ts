import { afterEach, describe, expect, it } from 'vitest';

import {
  createComposerPayloadHandoff,
  resetComposerPayloadHandoffsForTests,
  takeComposerPayloadHandoff,
} from '@/features/chat/composer/composer-payload-handoff';

describe('composer payload handoff', () => {
  afterEach(() => resetComposerPayloadHandoffsForTests());

  it('hands processed attachments to a new chat exactly once', () => {
    const attachments = [{ type: 'image', mimeType: 'image/png', data: 'aGVsbG8=', name: 'shot.png' }];
    const id = createComposerPayloadHandoff(attachments, 1_000);

    expect(takeComposerPayloadHandoff(id, 1_001)).toEqual(attachments);
    expect(takeComposerPayloadHandoff(id, 1_002)).toBeNull();
  });

  it('drops an expired handoff', () => {
    const id = createComposerPayloadHandoff([{ type: 'document', name: 'notes.txt' }], 1_000);

    expect(takeComposerPayloadHandoff(id, 121_000)).toBeNull();
  });
});
