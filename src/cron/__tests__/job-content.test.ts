import { describe, it, expect } from 'vitest';
import { getCronPayloadText } from '../job-content.js';

describe('getCronPayloadText', () => {
  it('reads systemEvent text', () => {
    expect(
      getCronPayloadText({
        payload: { kind: 'systemEvent', text: 'hello' },
      })
    ).toBe('hello');
  });

  it('reads agentTurn message', () => {
    expect(
      getCronPayloadText({
        payload: { kind: 'agentTurn', message: 'prompt' },
      })
    ).toBe('prompt');
  });
});
