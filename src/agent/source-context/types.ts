import type { ImageContent } from '@earendil-works/pi-ai';

export interface SessionSourceBinding {
  kind: 'note';
  sourceId: string;
  version: string;
  attachedAt: number;
}

export interface TurnContextRef {
  kind: 'note';
  sourceId: string;
  expectedVersion?: string;
}

export interface SourceContextRefSummary {
  kind: AgentSourceContext['kind'];
  sourceId: string;
  version: string;
  title: string;
  tokenEstimate?: number;
  truncated?: boolean;
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

export function summarizeSourceContext(context: AgentSourceContext): SourceContextRefSummary {
  return {
    kind: context.kind,
    sourceId: context.sourceId,
    version: context.version,
    title: context.title,
    tokenEstimate: context.tokenEstimate,
    truncated: context.truncated,
  };
}

export function isTurnContextRef(value: unknown): value is TurnContextRef {
  if (!value || typeof value !== 'object') return false;
  const row = value as Record<string, unknown>;
  return row.kind === 'note'
    && typeof row.sourceId === 'string'
    && row.sourceId.trim().length > 0
    && (row.expectedVersion === undefined || typeof row.expectedVersion === 'string');
}

export function parseTurnContextRefs(value: unknown, max = 5): TurnContextRef[] | null {
  if (value === undefined) return [];
  if (!Array.isArray(value) || value.length > max || !value.every(isTurnContextRef)) return null;
  return value.map((ref) => ({
    kind: ref.kind,
    sourceId: ref.sourceId.trim(),
    ...(ref.expectedVersion ? { expectedVersion: ref.expectedVersion } : {}),
  }));
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
