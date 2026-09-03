import { describe, expect, it, vi } from 'vitest';

import { commitAcceptedSend } from '../commit-accepted-send';
import { showComposerNotification } from '../composer-notifications';

vi.mock('../composer-notifications', () => ({ showComposerNotification: vi.fn() }));

describe('commitAcceptedSend', () => {
  it('commits an immediate accepted submission but not a rejected one', () => {
    const commit = vi.fn();
    commitAcceptedSend(undefined, commit);
    commitAcceptedSend(false, commit);
    expect(commit).toHaveBeenCalledOnce();
  });

  it('waits for acceptance before clearing input and attachments', async () => {
    const commit = vi.fn();
    let finish!: (accepted: boolean) => void;
    const result = new Promise<boolean>((resolve) => { finish = resolve; });
    commitAcceptedSend(result, commit);
    expect(commit).not.toHaveBeenCalled();
    finish(true);
    await result;
    expect(commit).toHaveBeenCalledOnce();
  });

  it('retains the draft when asynchronous creation is declined or fails', async () => {
    const commit = vi.fn();
    commitAcceptedSend(Promise.resolve(false), commit);
    commitAcceptedSend(Promise.reject(new Error('Environment unavailable')), commit);
    await new Promise<void>((resolve) => queueMicrotask(resolve));
    expect(commit).not.toHaveBeenCalled();
    expect(showComposerNotification).toHaveBeenCalledWith('error', 'Environment unavailable');
  });
});
