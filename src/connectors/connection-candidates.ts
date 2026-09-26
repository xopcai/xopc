import { getCliAdapter } from './cli/adapterRegistry.js';
import { getConnectorDefinition, listConnectorCatalog } from './catalog.js';

const CAPABILITY_PROFILES = [
  { toolkit: 'outlook', pattern: /outlook/i, capabilities: ['email.search', 'email.read'] },
  { toolkit: 'gmail', pattern: /gmail|mail|email|邮件|邮箱/i, capabilities: ['email.search', 'email.read'] },
  { toolkit: 'googlecalendar', pattern: /google.*calendar|calendar|日历|日程/i, capabilities: ['calendar.read'] },
  { toolkit: 'googledrive', pattern: /google.*drive|云盘|谷歌.*文档/i, capabilities: ['files.search', 'files.read'] },
  { toolkit: 'slack', pattern: /slack/i, capabilities: ['messages.search'] },
  { toolkit: 'notion', pattern: /notion/i, capabilities: ['pages.search', 'pages.read'] },
];

function normalizedIdentity(value: string): string {
  return value.toLocaleLowerCase().replace(/[^\p{L}\p{N}]+/gu, '');
}

function matchesConnectorIdentity(query: string, definition: ReturnType<typeof listConnectorCatalog>[number]): boolean {
  const normalizedQuery = normalizedIdentity(query);
  if (!normalizedQuery) return false;
  const runtimeIdentity = definition.runtime.type === 'composio' ? definition.runtime.toolkit : undefined;
  return [definition.id, definition.displayName, runtimeIdentity, ...(definition.tags ?? [])]
    .filter((value): value is string => typeof value === 'string'
      && !['composio', 'verified', 'beta', 'experimental'].includes(value))
    .some(value => {
      const identity = normalizedIdentity(value);
      return identity.length > 1 && normalizedQuery.includes(identity);
    });
}

function composioCandidate(definition: ReturnType<typeof listConnectorCatalog>[number]) {
  if (definition.runtime.type !== 'composio' || definition.runtime.role !== 'toolkit') return undefined;
  const toolkit = definition.runtime.toolkit;
  const profile = CAPABILITY_PROFILES.find(item => item.toolkit === toolkit);
  return {
    candidateRef: definition.id,
    label: definition.displayName,
    capabilities: profile?.capabilities ?? ['tools'],
  };
}

export function connectionCandidates(query: string) {
  const catalog = listConnectorCatalog();
  const managed = catalog.filter(definition => definition.runtime.type === 'cli' && matchesConnectorIdentity(query, definition)).map(definition => {
    const candidate = resolveConnectionCandidate(definition.id);
    return { candidateRef: definition.id, label: candidate.label, capabilities: candidate.capabilities };
  });
  const composio = catalog
    .filter(definition => matchesConnectorIdentity(query, definition))
    .flatMap(definition => {
      const candidate = composioCandidate(definition);
      return candidate ? [candidate] : [];
    });
  const aliases = CAPABILITY_PROFILES.filter(item => item.pattern.test(query)).flatMap(item => {
    const connectorId = `composio-${item.toolkit}`;
    const definition = getConnectorDefinition(connectorId);
    return definition ? [{ candidateRef: connectorId, label: definition.displayName, capabilities: item.capabilities }] : [];
  });
  return [...managed, ...composio, ...aliases]
    .filter((candidate, index, all) => all.findIndex(item => item.candidateRef === candidate.candidateRef) === index);
}
export function resolveConnectionCandidate(ref: string) {
  const definition = getConnectorDefinition(ref);
  if (definition?.runtime.type === 'cli') return { key: `${ref}:default`, target: { type: 'connector' as const, connectorId: ref }, label: definition.displayName,
    capabilities: Object.entries(getCliAdapter(definition.runtime.adapterId).curatedActions).filter(([, scope]) => scope === 'read').map(([id]) => id) };

  const candidate = definition ? composioCandidate(definition) : undefined;
  if (!candidate) throw new Error('Unknown connection candidate. Search for a supported app first.');
  return { key: `${ref}:default`, target: { type: 'connector' as const, connectorId: ref }, label: candidate.label, capabilities: candidate.capabilities };
}
