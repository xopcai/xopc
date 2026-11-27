import { getCliAdapter } from './cli/adapterRegistry.js';
import { getConnectorDefinition, listConnectorCatalog } from './catalog.js';
export { rankConnectionCandidatesByEcosystem } from './connection-ecosystem.js';

const CAPABILITY_PROFILES = [
  { toolkit: 'outlook', pattern: /\boutlook\b/i, capabilities: ['email.search', 'email.read'] },
  { toolkit: 'gmail', pattern: /\bgmail\b/i, capabilities: ['email.search', 'email.read'] },
  { toolkit: 'googlecalendar', pattern: /google.*calendar|谷歌.*日历/i, capabilities: ['calendar.read'] },
  { toolkit: 'googledrive', pattern: /google.*drive|谷歌.*(?:云盘|文档)/i, capabilities: ['files.search', 'files.read'] },
  { toolkit: 'slack', pattern: /\bslack\b/i, capabilities: ['messages.search'] },
] as const;

type CapabilityDomain = {
  id: 'email' | 'calendar' | 'files' | 'tasks' | 'messaging' | 'code';
  pattern: RegExp;
  toolkits: readonly string[];
  capabilityPrefix?: string;
};

const CAPABILITY_DOMAINS: readonly CapabilityDomain[] = [
  {
    id: 'email',
    pattern: /\b(?:mail|email|inbox|emails)\b|邮件|邮箱|收件箱/i,
    toolkits: ['gmail', 'outlook'],
    capabilityPrefix: 'email.',
  },
  {
    id: 'calendar',
    pattern: /\b(?:calendar|schedule|meetings?|events?|agenda)\b|日历|日程|会议|行程/i,
    toolkits: ['googlecalendar', 'outlook'],
    capabilityPrefix: 'calendar.',
  },
  {
    id: 'files',
    pattern: /\b(?:cloud\s*drive|drive|files?|documents?|docs?|spreadsheets?|sheets?)\b|云盘|网盘|云文档|文档|表格|文件/i,
    toolkits: ['googledrive', 'googledocs', 'googlesheets', 'one_drive', 'dropbox'],
    capabilityPrefix: 'files.',
  },
  {
    id: 'tasks',
    pattern: /\b(?:tasks?|issues?|tickets?|sprints?|kanban|bugs?)\b|任务|待办|工单|缺陷|需求/i,
    toolkits: ['linear', 'jira', 'asana', 'clickup', 'trello'],
  },
  {
    id: 'messaging',
    pattern: /\b(?:messages?|chat|channels?)\b|消息|群聊|聊天记录/i,
    toolkits: ['slack', 'microsoft_teams', 'discord'],
    capabilityPrefix: 'messages.',
  },
  {
    id: 'code',
    pattern: /\b(?:repos?|repositories|pull\s*requests?|commits?)\b|代码仓库|代码库|合并请求/i,
    toolkits: ['github'],
  },
];

// Bilingual keyword bridge so Chinese intent queries recall connectors by their
// English catalog descriptions without hardcoding narrow per-scenario rules.
const ZH_TO_EN_CATALOG_HINTS: ReadonlyArray<readonly [RegExp, readonly string[]]> = [
  [/日历|日程|会议|行程/u, ['calendar', 'events']],
  [/邮件|邮箱|收件箱/u, ['mail', 'email', 'messages']],
  [/云盘|网盘|云文档|文档|文件/u, ['drive', 'files', 'docs']],
  [/表格|工作簿/u, ['sheets', 'spreadsheets', 'workbooks', 'tables']],
  [/任务|待办|工单|缺陷|需求/u, ['tasks', 'issues', 'projects', 'boards', 'cards']],
  [/消息|群聊|聊天记录/u, ['messages', 'conversations']],
  [/代码仓库|代码库|合并请求/u, ['repositories', 'pull', 'requests']],
  [/发票|账单|支付|收款|订阅/u, ['invoices', 'payments', 'subscriptions']],
  [/订单|商品|店铺/u, ['orders', 'products']],
  [/客户|联系人|商机/u, ['contacts', 'customers', 'deals', 'opportunities']],
  [/设计稿|原型/u, ['figma', 'files', 'comments']],
  [/视频|频道|播放列表|音乐|歌单/u, ['videos', 'channels', 'playlists']],
];

const DESCRIPTION_STOP_WORDS = new Set([
  'the', 'and', 'for', 'with', 'from', 'that', 'this', 'your', 'have', 'into', 'about',
  'find', 'search', 'read', 'list', 'show', 'check', 'get', 'help', 'work', 'manage',
  'update', 'send', 'draft', 'create', 'connect', 'approved', 'recent', 'latest', 'my',
  'content', 'data', 'info', 'information', 'app', 'apps', 'tool', 'tools', 'account',
  'accounts', 'controls', 'actions', 'behalf', 'agents', 'using', 'please', 'need',
]);

function extractCatalogTokens(query: string): string[] {
  const lower = query.toLowerCase();
  const ascii = lower.match(/[a-z]{3,}/g) ?? [];
  const hinted = ZH_TO_EN_CATALOG_HINTS.flatMap(([pattern, terms]) => (pattern.test(query) ? terms : []));
  return [...new Set([...ascii, ...hinted])].filter(token => !DESCRIPTION_STOP_WORDS.has(token));
}

function matchesCatalogDescription(tokens: readonly string[], definition: ReturnType<typeof listConnectorCatalog>[number]): boolean {
  if (!tokens.length) return false;
  const haystack = new Set(
    `${definition.displayName} ${definition.description} ${(definition.tags ?? []).join(' ')}`
      .toLowerCase()
      .match(/[a-z]{3,}/g) ?? [],
  );
  return tokens.some(token => haystack.has(token));
}

// Explicit non-Composio / Store-plugin services should resolve via Store or MCP discovery
// rather than falling back to unrelated generic Composio domain aliases.
const EXPLICIT_EXTERNAL_SERVICE_PATTERN = /\b(?:feishu|lark|dingtalk|yuque|notion|todoist|wecom|wps)\b|飞书|钉钉|语雀|企业微信|企微/i;

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
    capabilities: profile ? [...profile.capabilities] : ['tools'],
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
  const profileAliases = CAPABILITY_PROFILES.filter(item => item.pattern.test(query)).flatMap(item => {
    const connectorId = `composio-${item.toolkit}`;
    const definition = getConnectorDefinition(connectorId);
    return definition ? [{ candidateRef: connectorId, label: definition.displayName, capabilities: [...item.capabilities] }] : [];
  });
  const isExplicitExternal = EXPLICIT_EXTERNAL_SERVICE_PATTERN.test(query);
  const domainAliases = isExplicitExternal
    ? []
    : CAPABILITY_DOMAINS.filter(domain => domain.pattern.test(query)).flatMap(domain =>
        domain.toolkits.flatMap(toolkit => {
          const connectorId = `composio-${toolkit}`;
          const definition = getConnectorDefinition(connectorId);
          if (!definition) return [];
          const candidate = composioCandidate(definition);
          return candidate ? [candidate] : [];
        }),
      );
  const catalogTokens = isExplicitExternal ? [] : extractCatalogTokens(query);
  const descriptionMatches = catalogTokens.length
    ? catalog
        .filter(definition => matchesCatalogDescription(catalogTokens, definition))
        .flatMap(definition => {
          const candidate = composioCandidate(definition);
          return candidate ? [candidate] : [];
        })
    : [];
  return [...managed, ...composio, ...profileAliases, ...domainAliases, ...descriptionMatches]
    .filter((candidate, index, all) => all.findIndex(item => item.candidateRef === candidate.candidateRef) === index);
}

/** Return alternative catalog connectors in the same capability domain(s). */
export function connectionCandidateAlternatives(
  connectorId: string,
  capabilities?: readonly string[],
): Array<{ candidateRef: string; label: string }> {
  const definition = getConnectorDefinition(connectorId);
  const toolkit = definition?.runtime.type === 'composio' && definition.runtime.role === 'toolkit'
    ? definition.runtime.toolkit
    : undefined;
  if (!toolkit) return [];
  const matchingDomains = CAPABILITY_DOMAINS.filter(domain => domain.toolkits.includes(toolkit));
  if (!matchingDomains.length) return [];
  const capabilityScoped = capabilities?.length
    ? matchingDomains.filter(domain => domain.capabilityPrefix
      && capabilities.some(cap => cap.startsWith(domain.capabilityPrefix!)))
    : [];
  const domains = capabilityScoped.length ? capabilityScoped : matchingDomains;
  const seen = new Set<string>([connectorId]);
  const alternatives: Array<{ candidateRef: string; label: string }> = [];
  for (const domain of domains) {
    for (const sibling of domain.toolkits) {
      const siblingId = `composio-${sibling}`;
      if (seen.has(siblingId)) continue;
      const siblingDef = getConnectorDefinition(siblingId);
      if (!siblingDef) continue;
      seen.add(siblingId);
      alternatives.push({ candidateRef: siblingId, label: siblingDef.displayName });
      if (alternatives.length >= 4) return alternatives;
    }
  }
  return alternatives;
}
export function resolveExactConnectionCandidate(app: string): string {
  const name = app.trim();
  if (getConnectorDefinition(name)) {
    resolveConnectionCandidate(name);
    return name;
  }
  const identity = normalizedIdentity(name);
  const matches = listConnectorCatalog().filter(definition => {
    const runtime = definition.runtime;
    if (runtime.type === 'composio' && runtime.role === 'toolkit') {
      return [definition.id, definition.displayName, runtime.toolkit].some(value => normalizedIdentity(value) === identity);
    }
    return runtime.type === 'cli'
      && [definition.id, definition.displayName].some(value => normalizedIdentity(value) === identity);
  });
  if (matches.length !== 1) throw new Error('Use personal_task(command="capabilities") or personal_capability to identify the exact supported app or connector ID');
  return matches[0].id;
}

export function resolveConnectionCandidate(ref: string) {
  const definition = getConnectorDefinition(ref);
  if (definition?.runtime.type === 'cli') return { key: `${ref}:default`, target: { type: 'connector' as const, connectorId: ref }, label: definition.displayName,
    capabilities: Object.entries(getCliAdapter(definition.runtime.adapterId).curatedActions).filter(([, scope]) => scope === 'read').map(([id]) => id) };

  const candidate = definition ? composioCandidate(definition) : undefined;
  if (!candidate) throw new Error('Unknown connection candidate. Search for a supported app first.');
  return { key: `${ref}:default`, target: { type: 'connector' as const, connectorId: ref }, label: candidate.label, capabilities: candidate.capabilities };
}
