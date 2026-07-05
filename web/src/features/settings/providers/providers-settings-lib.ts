import type { ProviderActiveKeySource, ProviderCategory, ProviderRowModel } from '@/features/settings/providers-api';
import type { ProvidersSettingsMessages } from '@/i18n/messages';

export const CATEGORY_ORDER: ProviderCategory[] = [
  'common',
  'domestic',
  'specialty',
  'enterprise',
  'oauth',
  'extension',
];

export function groupByCategory(rows: ProviderRowModel[]): Map<ProviderCategory, ProviderRowModel[]> {
  const map = new Map<ProviderCategory, ProviderRowModel[]>();
  for (const c of CATEGORY_ORDER) map.set(c, []);
  for (const r of rows) {
    const cat = r.category || 'specialty';
    const list = map.get(cat) ?? [];
    list.push(r);
    map.set(cat, list);
  }
  return map;
}

export function interpolate(template: string, params: Record<string, string>): string {
  return template.replace(/\{\{(\w+)\}\}/g, (_, key) => String(params[key] ?? ''));
}

export function activeSourceLabel(
  labels: ProvidersSettingsMessages,
  src: ProviderActiveKeySource | undefined,
): string {
  switch (src) {
    case 'agent':
      return labels.sourceAgent;
    case 'gateway':
      return labels.sourceGateway;
    case 'oauth':
      return labels.sourceOauth;
    case 'env':
      return labels.sourceEnv;
    case 'models_json':
      return labels.sourceModelsJson;
    case 'extension':
      return labels.sourceExtension;
    default:
      return labels.sourceNone;
  }
}
