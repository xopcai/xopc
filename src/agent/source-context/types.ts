import type { ImageContent } from '@earendil-works/pi-ai';

export interface SessionSourceBinding {
  kind: 'note';
  sourceId: string;
  version: string;
  attachedAt: number;
}

export interface AgentSourceContext {
  kind: SessionSourceBinding['kind'];
  sourceId: string;
  version: string;
  title: string;
  text: string;
  images?: ImageContent[];
  tokenEstimate?: number;
  truncated?: boolean;
}

export type AgentSourceContextResolver = (
  binding: SessionSourceBinding,
  sessionKey: string,
) => Promise<AgentSourceContext | null>;

export function isSessionSourceBinding(value: unknown): value is SessionSourceBinding {
  if (!value || typeof value !== 'object') return false;
  const row = value as Record<string, unknown>;
  return row.kind === 'note'
    && typeof row.sourceId === 'string'
    && row.sourceId.trim().length > 0
    && typeof row.version === 'string'
    && typeof row.attachedAt === 'number';
}
