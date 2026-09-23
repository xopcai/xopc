import type { ImageContent } from '@earendil-works/pi-ai';
import type { AppContextEnvelope } from '@xopcai/gateway-contract';
import type { GatewayPrincipal } from '../../gateway/security/gateway-principal.js';

export interface AppContextGrant {
  principal: GatewayPrincipal;
  authRevision: string;
}

export interface SessionSourceBinding {
  kind: 'note';
  sourceId: string;
  version: string;
  attachedAt: number;
}

export interface TurnContextRef {
  refId?: string;
  kind: 'note' | 'task' | 'file' | 'session' | 'browser_tab' | 'mcp_resource';
  sourceId: string;
  expectedVersion?: string;
}

export interface SourceContextRefSummary {
  refId?: string;
  kind: AgentSourceContext['kind'];
  sourceId: string;
  version: string;
  title: string;
  tokenEstimate?: number;
  truncated?: boolean;
  url?: string;
  capturedAt?: number;
  documentId?: string;
  fileKind?: 'file' | 'directory';
}

export interface AgentSourceContext {
  refId?: string;
  kind: SessionSourceBinding['kind'] | 'task' | 'file' | 'session' | 'mcp_resource' | 'browser_tab' | 'browser_page' | 'app_context';
  sourceId: string;
  version: string;
  title: string;
  text: string;
  images?: ImageContent[];
  tokenEstimate?: number;
  truncated?: boolean;
  url?: string;
  capturedAt?: number;
  documentId?: string;
  fileKind?: 'file' | 'directory';
  appContext?: AppContextEnvelope;
  appContextGrant?: AppContextGrant;
}

export function summarizeSourceContext(context: AgentSourceContext): SourceContextRefSummary {
  return {
    refId: context.refId,
    kind: context.kind,
    sourceId: context.sourceId,
    version: context.version,
    title: context.title,
    tokenEstimate: context.tokenEstimate,
    truncated: context.truncated,
    url: context.url,
    capturedAt: context.capturedAt,
    documentId: context.documentId,
    fileKind: context.fileKind,
  };
}

export function isTurnContextRef(value: unknown): value is TurnContextRef {
  if (!value || typeof value !== 'object') return false;
  const row = value as Record<string, unknown>;
  return (row.kind === 'note' || row.kind === 'task' || row.kind === 'file' || row.kind === 'session'
    || row.kind === 'browser_tab' || row.kind === 'mcp_resource')
    && typeof row.sourceId === 'string'
    && row.sourceId.trim().length > 0
    && (row.refId === undefined || typeof row.refId === 'string' && /^[A-Za-z0-9_-]{1,64}$/.test(row.refId))
    && (row.expectedVersion === undefined || typeof row.expectedVersion === 'string');
}

export function parseTurnContextRefs(value: unknown, max = 5): TurnContextRef[] | null {
  if (value === undefined) return [];
  if (!Array.isArray(value) || value.length > max || !value.every(isTurnContextRef)) return null;
  const refs = value.map((ref) => ({
    ...(ref.refId ? { refId: ref.refId } : {}),
    kind: ref.kind,
    sourceId: ref.sourceId.trim(),
    ...(ref.expectedVersion ? { expectedVersion: ref.expectedVersion } : {}),
  }));
  const refIds = refs.flatMap(ref => ref.refId ? [ref.refId] : []);
  const sources = refs.map(ref => `${ref.kind}:${ref.sourceId}`);
  if (new Set(refIds).size !== refIds.length || new Set(sources).size !== sources.length) return null;
  return refs;
}

export type AgentSourceContextResolver = (
  binding: SessionSourceBinding,
  conversationId: string,
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
