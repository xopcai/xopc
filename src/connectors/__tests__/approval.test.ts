import { describe, expect, it } from 'vitest';

import { connectorArgumentsHash, connectorArgumentsPreview } from '../approval.js';

describe('connector approval arguments', () => {
  it('hashes equivalent objects deterministically', () => {
    expect(connectorArgumentsHash({ b: 2, a: { y: 2, x: 1 } }))
      .toBe(connectorArgumentsHash({ a: { x: 1, y: 2 }, b: 2 }));
  });

  it('redacts secrets and bounds nested previews', () => {
    expect(connectorArgumentsPreview({
      password: 'do-not-show',
      nested: { authorization: 'Bearer secret', message: 'x'.repeat(400) },
    })).toEqual({
      password: '[redacted]',
      nested: { authorization: '[redacted]', message: `${'x'.repeat(160)}…` },
    });
  });
});
