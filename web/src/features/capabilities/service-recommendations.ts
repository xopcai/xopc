export type ServiceSource = 'store-plugin' | 'builtin-connector' | 'store-connector' | 'registry-connector';
export type ServiceIdentity = { id: string; source: ServiceSource; regions?: string[] };

const SERVICE_ALIASES: Readonly<Record<string, string>> = {
  'notion-office': 'notion',
  'todoist-mcp': 'todoist',
  'amap-maps': 'amap',
  'feishu-workspace': 'feishu',
  'wecom-workspace': 'wecom',
  'dingtalk-workspace': 'dingtalk',
  'wps365-workspace': 'wps365',
};

// These are ranking hints only; availability and installation come from the Store.
const CHINESE_SERVICE_ORDER = [
  'feishu', 'wecom', 'dingtalk', 'tencent-docs', 'wps365', 'yuque',
  'dida365', 'flomo', 'tencent-meeting', 'amap', 'bailian-web-search',
  'railway-12306', 'antv-chart',
];
const SOURCE_PRIORITY: Record<ServiceSource, number> = {
  'store-plugin': 0, 'builtin-connector': 1, 'store-connector': 2, 'registry-connector': 3,
};

export function canonicalServiceId(id: string): string {
  const normalized = id.toLowerCase().replace(/^composio-/, '');
  return SERVICE_ALIASES[normalized] ?? normalized;
}

export function chineseServiceRank(service: ServiceIdentity | undefined): number {
  if (!service) return Number.MAX_SAFE_INTEGER;
  const index = CHINESE_SERVICE_ORDER.indexOf(canonicalServiceId(service.id));
  return index >= 0 ? index : service.regions?.includes('china') ? CHINESE_SERVICE_ORDER.length : Number.MAX_SAFE_INTEGER;
}

/** Deduplicate discovery only. Installed resources retain their own management entries. */
export function recommendServices<T extends { service?: ServiceIdentity }>(items: T[], language: string): T[] {
  const preferred = new Map<string, T>();
  for (const item of items) {
    if (!item.service) continue;
    const key = canonicalServiceId(item.service.id);
    const previous = preferred.get(key);
    if (!previous?.service || SOURCE_PRIORITY[item.service.source] < SOURCE_PRIORITY[previous.service.source]) {
      preferred.set(key, item);
    }
  }
  const unique = items.filter(item => !item.service || preferred.get(canonicalServiceId(item.service.id)) === item);
  return language.startsWith('zh')
    ? unique.toSorted((a, b) => chineseServiceRank(a.service) - chineseServiceRank(b.service))
    : unique;
}
