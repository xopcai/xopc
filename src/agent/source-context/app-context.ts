import { createHash } from 'node:crypto';
import { ResolvedAppContextSchema, parseAppContextEnvelope, type ResolvedAppContext } from '@xopcai/gateway-contract';

import type { AgentSourceContext } from './types.js';

/** Accept only server-resolved resources; never use this as a client authority boundary. */
export function appContextToAgentContext(input: ResolvedAppContext): AgentSourceContext {
  const resolved = ResolvedAppContextSchema.parse(input);
  const snapshot = parseAppContextEnvelope(resolved.snapshot);
  if (resolved.resources.length !== snapshot.resourceRefs.length
    || resolved.resources.some((resource, index) => {
      const reference = snapshot.resourceRefs[index]!;
      return resource.reference.kind !== reference.kind || resource.reference.id !== reference.id
        || resource.reference.revision !== reference.revision;
    })) throw new Error('Resolved resources do not match the captured snapshot');

  // JSON quoting prevents source text from masquerading as surrounding prompt markup.
  const text = JSON.stringify({
    resources: resolved.resources,
    selection: snapshot.selection ? { ...snapshot.selection, trust: 'user-supplied' } : undefined,
  }).replaceAll('<', '\\u003c').replaceAll('>', '\\u003e');
  return {
    kind: 'app_context',
    sourceId: `${snapshot.tabId}:${snapshot.sequence}`,
    version: createHash('sha256').update(JSON.stringify({ snapshot, text })).digest('hex'),
    title: 'Application context',
    text,
    capturedAt: snapshot.capturedAt,
    truncated: resolved.resources.some(resource => resource.truncated),
    appContext: snapshot,
  };
}
