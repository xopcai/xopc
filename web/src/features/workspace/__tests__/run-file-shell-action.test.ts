import { beforeEach, describe, expect, it, vi } from 'vitest';

const { notify } = vi.hoisted(() => ({ notify: vi.fn() }));
vi.mock('@/features/chat/composer/composer-notifications', () => ({
  showComposerNotification: notify,
}));

import { runFileShellAction } from '../run-file-shell-action';

describe('runFileShellAction', () => {
  beforeEach(() => notify.mockClear());

  it('accepts both shell result shapes', async () => {
    await expect(runFileShellAction(async () => ({ ok: true }), 'failed')).resolves.toBe(true);
    await expect(runFileShellAction(async () => ({ success: true }), 'failed')).resolves.toBe(true);
    expect(notify).not.toHaveBeenCalled();
  });

  it('reports failures and leaves cancellation quiet', async () => {
    await expect(runFileShellAction(async () => ({ ok: false, error: 'missing' }), 'failed')).resolves.toBe(false);
    expect(notify).toHaveBeenCalledWith('warning', 'missing', undefined, { duration: 4000 });

    notify.mockClear();
    await expect(runFileShellAction(
      async () => ({ ok: false, code: 'CANCELED', error: 'canceled' }),
      'failed',
    )).resolves.toBe(false);
    expect(notify).not.toHaveBeenCalled();
  });

  it('reports unavailable bridges and thrown errors with the fallback', async () => {
    await expect(runFileShellAction(() => undefined, 'failed')).resolves.toBe(false);
    await expect(runFileShellAction(async () => { throw new Error('private'); }, 'failed')).resolves.toBe(false);
    expect(notify).toHaveBeenCalledTimes(2);
    expect(notify).toHaveBeenLastCalledWith('warning', 'failed', undefined, { duration: 4000 });
  });
});
