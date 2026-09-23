import { getCliAdapter } from './cli/adapterRegistry.js';
import { getConnectorDefinition, listConnectorCatalog } from './catalog.js';

const CANDIDATES = [
  { toolkit: 'outlook', pattern: /outlook/i, capabilities: ['email.search', 'email.read'] },
  { toolkit: 'gmail', pattern: /gmail|mail|email|邮件|邮箱/i, capabilities: ['email.search', 'email.read'] },
  { toolkit: 'googlecalendar', pattern: /google.*calendar|calendar|日历|日程/i, capabilities: ['calendar.read'] },
  { toolkit: 'googledrive', pattern: /google.*drive|云盘|谷歌.*文档/i, capabilities: ['files.search', 'files.read'] },
  { toolkit: 'slack', pattern: /slack/i, capabilities: ['messages.search'] },
  { toolkit: 'notion', pattern: /notion/i, capabilities: ['pages.search', 'pages.read'] },
];
export function connectionCandidates(query: string) {
  const managed = listConnectorCatalog().filter(definition => definition.runtime.type === 'cli' && [definition.id, definition.displayName, ...(definition.tags ?? [])].some(term => term.toLowerCase().includes(query.toLowerCase().trim()) || query.toLowerCase().includes(term.toLowerCase()))).map(definition => {
    const candidate = resolveConnectionCandidate(definition.id);
    return { candidateRef: definition.id, label: candidate.label, capabilities: candidate.capabilities };
  });
  return [...managed, ...CANDIDATES.filter(item => item.pattern.test(query)).flatMap(item => {
    const connectorId = `composio-${item.toolkit}`;
    const definition = getConnectorDefinition(connectorId);
    return definition ? [{ candidateRef: connectorId, label: definition.displayName, capabilities: item.capabilities }] : [];
  })];
}
export function resolveConnectionCandidate(ref: string) {
  const cli = getConnectorDefinition(ref);
  if (cli?.runtime.type === 'cli') return { key: `${ref}:default`, target: { type: 'connector' as const, connectorId: ref }, label: cli.displayName,
    capabilities: Object.entries(getCliAdapter(cli.runtime.adapterId).curatedActions).filter(([, scope]) => scope === 'read').map(([id]) => id) };

  const item = CANDIDATES.find(item => `composio-${item.toolkit}` === ref);
  const definition = item ? getConnectorDefinition(ref) : undefined;
  if (!item || !definition) throw new Error('Unknown connection candidate. Search for a supported app first.');
  return { key: `${ref}:default`, target: { type: 'connector' as const, connectorId: ref }, label: definition.displayName, capabilities: item.capabilities };
}
