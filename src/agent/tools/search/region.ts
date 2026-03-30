import type { WebToolsConfig } from '../../../config/schema.js';

const CHINA_TIMEZONES = new Set([
  'Asia/Shanghai',
  'Asia/Chongqing',
  'Asia/Harbin',
  'Asia/Urumqi',
  'Asia/Kashgar',
]);

/**
 * Resolve region for HTML search fallback: explicit config → timezone → global.
 */
export function resolveWebSearchRegion(web?: WebToolsConfig): 'cn' | 'global' {
  if (web?.region === 'cn' || web?.region === 'global') {
    return web.region;
  }
  try {
    const timezone = Intl.DateTimeFormat().resolvedOptions().timeZone;
    if (timezone && CHINA_TIMEZONES.has(timezone)) {
      return 'cn';
    }
  } catch {
    // ignore
  }
  return 'global';
}
