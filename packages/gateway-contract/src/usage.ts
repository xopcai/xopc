export type UsageBillingSource = 'xopc_cloud' | 'external_provider' | 'local';
export type UsageCloudBilling = {
  source: 'xopc_cloud';
  state: 'unavailable' | 'pending' | 'settled' | 'released';
  requestId?: string;
  reservedCreditMicro: string | null;
  chargedCreditMicro: string | null;
  releasedCreditMicro: string | null;
};
export type UsageBilling = UsageCloudBilling | { source: 'external_provider'; currency: 'USD'; estimatedCostUsd?: string } | { source: 'local' };

export type UsageTotals = {
  calls: number;
  succeededCalls: number;
  failedCalls: number;
  unknownCostCalls: number;
  inputTokens: number;
  outputTokens: number;
  cacheReadTokens: number;
  cacheWriteTokens: number;
  totalTokens: number;
  knownCostUsd: string;
  costCompleteness: 'complete' | 'partial' | 'unknown';
  billing?: {
    external: { calls: number; estimatedCostUsd: string; unknownCostCalls: number };
    localCalls: number;
    cloud: { calls: number; settledCalls: number; pendingCalls: number; unavailableCalls: number;
      chargedCreditMicro: string | null; reservedCreditMicro: string | null };
  };
};

export type UsageEvent = {
  id: string;
  traceId: string;
  parentEventId?: string;
  conversationId?: string;
  runId?: string;
  agentId?: string;
  category: string;
  operation: string;
  trigger: string;
  reasonKey: string;
  provider: string;
  model: string;
  status: string;
  startedAt: number;
  finishedAt?: number;
  durationMs?: number;
  inputTokens?: number;
  outputTokens?: number;
  cacheReadTokens?: number;
  cacheWriteTokens?: number;
  reasoningTokens?: number;
  totalTokens?: number;
  estimatedCostUsd?: string;
  costSource: string;
  pricingSnapshot?: { input: number; output: number; cacheRead: number; cacheWrite: number };
  errorSummary?: string;
  billing?: UsageBilling;
};
