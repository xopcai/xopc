export interface XopcMessageLink { kind: string; page: string; itemId: string; path: string; }

const PRODUCT_PAGES: Record<string, string> = {
  'session': 'chat', 'note': 'notes', 'task': 'tasks', 'project': 'projects', 'automation': 'automations',
  'file': 'files', 'settings': 'settings'
};

const SETTINGS_SECTIONS: string[] = ['', 'language', 'appearance', 'notifications', 'about'];

function validRelativeSegments(value: string): boolean {
  if (!value || value.startsWith('/') || value.endsWith('/') || /[\u0000-\u001f\u007f\\]/.test(value)) return false;
  return !value.split('/').some((part: string): boolean => !part || part === '.' || part === '..');
}

function validSingleId(value: string): boolean {
  return !!value && value !== '.' && value !== '..' && !/[\u0000-\u001f\u007f\\/]/.test(value);
}

export function internalMessageLink(raw: string): XopcMessageLink | undefined {
  if (!raw || raw.length > 4096 || /[\u0000-\u001f\u007f\\]/.test(raw)) return undefined;
  try {
    const target = raw.trim().replace(/&amp;/g, '&');
    if (/^xopc:\/\/[^/?#]*[@:]/.test(target)) return undefined;
    if (target.startsWith('xopc-file:')) {
      const encoded = target.slice('xopc-file:'.length);
      if (!encoded || /[?#]/.test(encoded)) return undefined;
      const itemId = decodeURIComponent(encoded);
      return validSingleId(itemId) ? { kind: 'route', page: 'files', itemId, path: '' } : undefined;
    }
    const base = target.split(/[?#]/)[0];
    const query: Record<string, string> = {};
    const question = target.indexOf('?');
    if (question >= 0) {
      for (const pair of target.slice(question + 1).split('#')[0].split('&')) {
        const equal = pair.indexOf('=');
        if (equal >= 0) query[decodeURIComponent(pair.slice(0, equal))] = decodeURIComponent(pair.slice(equal + 1).replace(/\+/g, ' '));
      }
    }
    if (base === 'xopc://workspace/file' || base === '/xopc/workspace/file') {
      const path = (query['path'] || '').trim();
      if (!validRelativeSegments(path)) return undefined;
      return { kind: 'file', path, page: '', itemId: '' };
    }
    if (base === 'xopc://capabilities/mcp') {
      const id = query['id'] || '';
      const url = query['url'] || '';
      if (!/^[a-zA-Z0-9_-]{1,64}$/.test(id) || url.length > 2048 || !/^https:\/\/[^\s/@?#[\]\\]+(?:\/[^\s?#\\]*)?$/.test(url)) return undefined;
      return { kind: 'route', page: 'capability-mcp-setup', itemId: id, path: url };
    }
    if (base === 'xopc://open' || base === 'xopc://open/') {
      const kind = query['kind'];
      if (kind === 'settings') {
        const section = (query['id'] ?? '').trim();
        return SETTINGS_SECTIONS.includes(section) ? { kind: 'route', page: 'settings', itemId: section, path: '' } : undefined;
      }
      const page = Object.keys(PRODUCT_PAGES).includes(kind) ? PRODUCT_PAGES[kind] : '';
      const itemId = (query['id'] || (kind === 'session' ? query['key'] : '') || '').trim();
      if (page && validRelativeSegments(itemId)) return { kind: 'route', page, itemId, path: '' };
      return undefined;
    }
    const route = target.startsWith('xopc://settings') ? target.replace(/^xopc:\/\/settings(?=\/|$|\?)/, '/settings')
      : target.startsWith('#/') ? target.slice(1) : target;
    if (!route.startsWith('/') || route.startsWith('//')) return undefined;
    const parts = route.split(/[?#]/)[0].split('/');
    const root = parts[1] || '';
    if (parts[0] === '' && ['chat', 'sessions', 'tasks', 'projects', 'notes', 'automations', 'files', 'settings'].includes(root)) {
      if (root === 'settings') {
        if (parts.length > 3) return undefined;
        const section = parts.length === 3 ? decodeURIComponent(parts[2]) : '';
        return SETTINGS_SECTIONS.includes(section) ? { kind: 'route', page: 'settings', itemId: section, path: '' } : undefined;
      }
      if (root === 'automations' && (parts.length === 2 || (parts.length === 3 && !parts[2]))) {
        if (query['run'] !== undefined) {
          return validSingleId(query['run']) ? { kind: 'route', page: 'automation-run', itemId: query['run'], path: '' } : undefined;
        }
        if (query['automation'] !== undefined) {
          return validSingleId(query['automation']) ? { kind: 'route', page: 'automations', itemId: query['automation'], path: '' } : undefined;
        }
      }
      if (parts.length !== 3) return undefined;
      const itemId = decodeURIComponent(parts[2]);
      if (!validSingleId(itemId)) return undefined;
      return { kind: 'route', page: root === 'sessions' ? 'chat' : root, itemId, path: '' };
    }
  } catch (_) {}
  return undefined;
}
