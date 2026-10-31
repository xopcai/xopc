import { expect, it, vi } from 'vitest';

import { dismissLocalConnectionOnboarding } from '../electron-local-connection-fixture.mjs';

function fixture(advanceWhileClicking: boolean, blocked = false) {
  let stage = 'model';
  const dismiss = {
    waitFor: async () => {}, isVisible: async () => stage === 'model',
    click: vi.fn(async () => {
      if (blocked) throw new Error('genuine click failure');
      stage = 'sources';
      if (advanceWhileClicking) throw new Error('previous step detached');
    }),
  };
  const skip = {
    waitFor: async () => { if (stage !== 'sources') throw new Error('not visible'); },
    isVisible: async () => stage === 'sources', click: vi.fn(async () => { stage = 'done'; }),
  };
  return { page: { getByRole: (_role: string, options: { name: string }) => options.name === 'Skip for now' ? skip : dismiss }, dismiss, skip, stage: () => stage };
}
it('handles the next onboarding step when the previous click is detached', async () => {
  const value = fixture(true); await dismissLocalConnectionOnboarding(value.page);
  expect(value.stage()).toBe('done'); expect(value.skip.click).toHaveBeenCalledOnce();
});
it('still clicks both ordinary onboarding steps without forcing pointer events', async () => {
  const value = fixture(false); await dismissLocalConnectionOnboarding(value.page);
  expect(value.stage()).toBe('done'); expect(value.dismiss.click).toHaveBeenCalledOnce();
  expect(value.skip.click).toHaveBeenCalledOnce();
});
it('does not swallow a genuine click failure while the same step remains visible', async () => {
  const value = fixture(false, true);
  await expect(dismissLocalConnectionOnboarding(value.page)).rejects.toThrow('genuine click failure');
  expect(value.skip.click).not.toHaveBeenCalled();
});
