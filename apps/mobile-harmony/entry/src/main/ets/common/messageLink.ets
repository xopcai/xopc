export interface XopcMessageLink { kind: string; page: string; itemId: string; path: string; }

const PRODUCT_PAGES: Record<string, string> = {
  'session': 'chat', 'note': 'notes', 'task': 'tasks', 'project': 'projects', 'automation': 'automations',
  'file': 'files', 'workflow_run': 'workflows', 'settings': 'settings'
};

export function internalMessageLink(raw: string): XopcMessageLink | undefined {
  if (!raw || /[\u0000-\u001f\u007f\\]/.test(raw)) return undefined;
  try {
    const target = raw.replace(/&amp;/g, '&');
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
      if (!path || /[\u0000-\u001f\u007f]/.test(path) || path.replace(/\\/g, '/').split('/').includes('..')) return undefined;
      return { kind: 'file', path, page: '', itemId: '' };
    }
    if (base === 'xopc://open' || base === 'xopc://open/') {
      const kind = query['kind'];
      const page = Object.keys(PRODUCT_PAGES).includes(kind) ? PRODUCT_PAGES[kind] : '';
      const itemId = (query['id'] || (kind === 'session' ? query['key'] : '') || '').trim();
      if (page && itemId && !/[\u0000-\u001f\u007f]/.test(itemId)) return { kind: 'route', page, itemId, path: '' };
      return undefined;
    }
    const route = target.startsWith('xopc://settings') ? target.replace(/^xopc:\/\/settings(?=\/|$|\?)/, '/settings')
      : target.startsWith('#/') ? target.slice(1) : target;
    const parts = route.split(/[?#]/)[0].split('/');
    if (parts[0] === '' && ['chat', 'sessions', 'tasks', 'projects', 'notes', 'automations', 'files', 'workflows', 'settings'].includes(parts[1])) {
      const itemId = decodeURIComponent(parts.slice(2).join('/'));
      if (/[\u0000-\u001f\u007f]/.test(itemId) || itemId.split('/').includes('..')) return undefined;
      return { kind: 'route', page: parts[1], itemId, path: '' };
    }
  } catch (_) {}
  return undefined;
}
