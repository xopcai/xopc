import { getEmbeddedExecutionRunId, getEmbeddedExecutionSession } from '../agent/embedded/execution-context.js';
import { startAiUsageCall } from './recorder.js';

/** Cloud tools receive independent receipts even when the parent chat uses BYOK. */
export async function trackCloudCapabilityUsage<T>(model: string, operation: string, action: () => Promise<T>): Promise<T> {
  const call = startAiUsageCall({ provider: 'xopc-cloud', id: model, baseUrl: undefined,
    cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 } },
  { operation, conversationId: getEmbeddedExecutionSession(), runId: getEmbeddedExecutionRunId() });
  try {
    const result = await call.run(action);
    call.finish({ status: 'succeeded' });
    return result;
  } catch (error) {
    call.finish({ status: 'failed', errorSummary: error instanceof Error ? error.message : String(error) });
    throw error;
  }
}
