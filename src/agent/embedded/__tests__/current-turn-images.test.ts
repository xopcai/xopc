import { describe, expect, it } from 'vitest';
import type { AgentMessage } from '@earendil-works/pi-agent-core';

import { restoreCurrentTurnImages } from '../current-turn-images.js';

const image = { type: 'image' as const, data: 'aW1hZ2U=', mimeType: 'image/png' };

describe('restoreCurrentTurnImages', () => {
  it('restores an image omitted by the persisted session projection', () => {
    const messages = [
      { role: 'user', content: 'Earlier turn', timestamp: 1 },
      { role: 'user', content: 'Describe this image', turnId: 'current', timestamp: 2 },
      { role: 'user', content: 'Later context', timestamp: 3 },
    ] as AgentMessage[];

    const restored = restoreCurrentTurnImages(messages, [image], 'current');

    expect(restored[1]).toMatchObject({ content: [
      { type: 'text', text: 'Describe this image' }, image,
    ] });
    expect(restored[2]).toBe(messages[2]);
    expect(messages[1]).toMatchObject({ content: 'Describe this image' });
  });

  it('does not duplicate images already in the model context', () => {
    const messages = [{ role: 'user', content: [{ type: 'text', text: 'Look' }, image], timestamp: 1 }] as AgentMessage[];
    expect(restoreCurrentTurnImages(messages, [image], 'current')).toBe(messages);
  });
});
