export type TraceRecord = {
  traceId: string; spanId: string; parentSpanId?: string; name: string;
  type: 'agent' | 'generation' | 'tool' | 'span';
  startedAt: number; endedAt?: number; status: string;
  attributes: Record<string, string | number | boolean>;
};
export type TraceQuery = {
  limit?: number; cursor?: string; status?: string; conversationId?: string;
  runId?: string; agentId?: string; from?: number; to?: number;
};
