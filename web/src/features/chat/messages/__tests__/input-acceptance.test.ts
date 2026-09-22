import { describe, expect, it, vi } from 'vitest';

import { trackInputAcceptance } from '../input-acceptance';

describe('input acceptance', () => {
  it('accepts before a long-running response completes', async () => {
    let finish!: () => void;
    const completed = vi.fn();
    const accepted = trackInputAcceptance(async accept => {
      accept();
      await new Promise<void>(resolve => { finish = resolve; });
      completed();
    });
    await expect(accepted).resolves.toBe(true);
    expect(completed).not.toHaveBeenCalled();
    finish();
    await vi.waitFor(() => expect(completed).toHaveBeenCalledOnce());
  });

  it('does not consume a draft when submission throws or finishes without acceptance', async () => {
    await expect(trackInputAcceptance(async () => { throw new Error('Rejected'); })).resolves.toBe(false);
    await expect(trackInputAcceptance(async () => {})).resolves.toBe(false);
  });

  it('does not revoke acceptance when later streaming fails', async () => {
    await expect(trackInputAcceptance(async accept => {
      accept();
      throw new Error('Stream disconnected');
    })).resolves.toBe(true);
  });
});
