import { describe, expect, it } from 'vitest';

import { getEmbeddedExecutionSession, runWithEmbeddedExecutionSession } from '../execution-context.js';

describe('embedded execution context', () => {
  it('isolates concurrent ephemeral interaction routes', async () => {
    const readLater = (sessionKey: string) => runWithEmbeddedExecutionSession(sessionKey, async () => {
      await Promise.resolve();
      return getEmbeddedExecutionSession();
    });

    await expect(Promise.all([readLater('side-a'), readLater('side-b')])).resolves.toEqual(['side-a', 'side-b']);
    expect(getEmbeddedExecutionSession()).toBeUndefined();
  });
});
