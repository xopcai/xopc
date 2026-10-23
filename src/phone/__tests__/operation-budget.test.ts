import { afterEach, expect, it, vi } from 'vitest';

import { PhoneOperationBudget } from '../live-state.js';

afterEach(() => vi.useRealTimers());

it('keeps the configurable active budget across human pauses and distinguishes expiry from cancellation', async () => {
  vi.useFakeTimers();
  const budget = new PhoneOperationBudget(5000);
  budget.resume();
  await vi.advanceTimersByTimeAsync(2000);
  budget.pause();
  await vi.advanceTimersByTimeAsync(180_000);
  expect(budget.controller.signal.aborted).toBe(false);
  budget.resume();
  await vi.advanceTimersByTimeAsync(2999);
  expect(budget.controller.signal.aborted).toBe(false);
  await vi.advanceTimersByTimeAsync(1);
  expect(budget.controller.signal.reason).toMatchObject({ code: 'PHONE_OPERATION_TIMEOUT' });
  budget.dispose();
});
