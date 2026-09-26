import type { Model, Api, Usage } from '@earendil-works/pi-ai/compat';

export type AiUsageStatus = 'running' | 'succeeded' | 'failed' | 'aborted' | 'unknown';
export type AiUsageTrigger = 'user' | 'scheduled' | 'system' | 'agent' | 'retry';
export type AiUsageCostSource = 'model_catalog' | 'local' | 'unknown';

export type AiUsageCategory =
  | 'chat'
  | 'tool_loop'
  | 'delegation'
  | 'compaction'
  | 'session_title'
  | 'image_understanding'
  | 'web_extract'
  | 'session_search'
  | 'note_generation'
  | 'automation'
  | 'scene'
  | 'task_planning'
  | 'task_judging'
  | 'voice_summary'
  | 'home_intelligence'
  | 'work_discovery'
  | 'discussion_analysis'
  | 'other';

export type AiUsageContext = {
  operation: string;
  trigger?: AiUsageTrigger;
  traceId?: string;
  parentEventId?: string;
  conversationId?: string;
  runId?: string;
  agentId?: string;
};

export type AiPricingSnapshot = {
  input: number;
  output: number;
  cacheRead: number;
  cacheWrite: number;
};

export type AiUsageEvent = {
  id: string;
  traceId: string;
  parentEventId?: string;
  conversationId?: string;
  runId?: string;
  agentId?: string;
  category: AiUsageCategory;
  operation: string;
  trigger: AiUsageTrigger;
  reasonKey: string;
  provider: string;
  model: string;
  status: AiUsageStatus;
  startedAt: number;
  finishedAt?: number;
  durationMs?: number;
  inputTokens?: number;
  outputTokens?: number;
  cacheReadTokens?: number;
  cacheWriteTokens?: number;
  reasoningTokens?: number;
  totalTokens?: number;
  estimatedCostMicrousd?: number;
  costSource: AiUsageCostSource;
  pricingSnapshot?: AiPricingSnapshot;
  errorSummary?: string;
};

export type AiUsageFinish = {
  status: Exclude<AiUsageStatus, 'running'>;
  usage?: Usage;
  errorSummary?: string;
  finishedAt?: number;
};

export type AiUsageModel = Pick<Model<Api>, 'provider' | 'id' | 'baseUrl' | 'cost'>;
