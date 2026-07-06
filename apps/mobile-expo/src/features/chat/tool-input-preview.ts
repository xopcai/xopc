// Pure helpers that pull short, human-readable previews out of arbitrary
// `tool_use` block inputs (which arrive as either parsed objects or raw JSON strings).

export function formatParamsJson(params: unknown): string {
  if (params === undefined) return '';
  try {
    return JSON.stringify(JSON.parse(params as string), null, 2);
  } catch {
    try {
      return JSON.stringify(params, null, 2);
    } catch {
      return String(params);
    }
  }
}

function parseInputAsObject(input: unknown): Record<string, unknown> | null {
  if (input == null) return null;
  try {
    return typeof input === 'string'
      ? (JSON.parse(input) as Record<string, unknown>)
      : (input as Record<string, unknown>);
  } catch {
    return null;
  }
}

export function extractSearchQuery(input: unknown): string {
  const obj = parseInputAsObject(input);
  const q = obj?.query ?? obj?.q ?? obj?.query_string ?? obj?.search_term ?? obj?.searchQuery;
  if (typeof q === 'string') return q;
  if (typeof q === 'number') return String(q);
  return '';
}

export function extractPathPreview(input: unknown): string {
  const obj = parseInputAsObject(input);
  const p = obj?.path ?? obj?.file_path ?? obj?.filepath ?? obj?.file;
  if (typeof p === 'string') return p;
  return '';
}

export function extractUrlPreview(input: unknown): string {
  const obj = parseInputAsObject(input);
  const u = obj?.url ?? obj?.href ?? obj?.uri ?? obj?.website;
  if (typeof u === 'string') return u;
  return '';
}

export function extractCommandPreview(input: unknown): string {
  const obj = parseInputAsObject(input);
  const c = obj?.command ?? obj?.cmd ?? obj?.shell ?? obj?.script;
  if (typeof c === 'string') return c;
  return '';
}

const KEY_DETAIL_MAX = 120;

export function getKeyDetailLine(input: unknown): string {
  if (input == null) return '';
  const obj = parseInputAsObject(input);
  if (!obj) {
    return typeof input === 'string' ? input.trim() : '';
  }

  const candidates = [
    obj.command,
    obj.cmd,
    obj.shell,
    obj.script,
    obj.path,
    obj.file_path,
    obj.filepath,
    obj.file,
    obj.url,
    obj.href,
    obj.uri,
    obj.website,
    obj.query,
    obj.q,
    obj.query_string,
    obj.search_term,
    obj.searchQuery,
  ];

  for (const c of candidates) {
    if (typeof c === 'string' && c.trim()) {
      const t = c.trim();
      return t.length > KEY_DETAIL_MAX ? `${t.slice(0, KEY_DETAIL_MAX)}…` : t;
    }
    if (typeof c === 'number' && Number.isFinite(c)) {
      return String(c);
    }
  }
  return '';
}
