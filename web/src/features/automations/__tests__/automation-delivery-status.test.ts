import { describe, expect, it } from 'vitest';
import type { AutomationResultDeliveryRecord } from '../automation-api';
import { deliveryFeedback } from '../automation-delivery-status';

const delivery = (status: AutomationResultDeliveryRecord['status']): AutomationResultDeliveryRecord => ({
  runId: 'run', destinationKey: 'gateway', kind: 'gateway_event', status, attempts: 1,
  createdAtMs: 1, updatedAtMs: 1, nextAttemptAtMs: 1,
});
describe('task delivery feedback', () => {
  it('never describes producer handoff as device delivery', () => {
    expect(deliveryFeedback([delivery('delivered')], 'zh')).toBeNull();
    expect(deliveryFeedback([], 'zh')).toBeNull();
  });
  it('distinguishes saved results from delivery problems and asks to resend without rerunning', () => {
    expect(deliveryFeedback([delivery('retrying')], 'zh')).toContain('结果已保存');
    expect(deliveryFeedback([delivery('delivered'), delivery('dead_letter')], 'zh')).toContain('无需重跑任务');
    expect(deliveryFeedback([delivery('dead_letter')], 'en')).toContain('without rerunning');
  });
});
