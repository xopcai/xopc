import {
  parseProductReferenceDeepLink,
  productReferenceOpenRoute,
} from '@xopcai/gateway-contract';

const KNOWN_FILE_EXT =
  'png|jpe?g|gif|webp|bmp|svg|pdf|docx?|xlsx?|pptx?|txt|md|json|html?|css|mjs?|cjs|js|ts|tsx|jsx|yaml|yml|toml|xml';

const WORKSPACE_RELATIVE_FILE_RE = new RegExp(
  String.raw`((?:\.\/)?(?:[A-Za-z0-9_.-]+\/)+[A-Za-z0-9_.-]+\.(?:${KNOWN_FILE_EXT})(?::\d+|#L\d+)?)`,
  'gi',
);
const UNIX_ABSOLUTE_FILE_RE = new RegExp(
  String.raw`(\/(?:Users|usr|var|opt|tmp|home|root|System|private|dev|media|mnt|Volumes|data)\/[^\s"'<>()|*?\n]+?\.(?:${KNOWN_FILE_EXT})(?::\d+|#L\d+)?)`,
  'gi',
);
const WIN_ABSOLUTE_FILE_RE = new RegExp(
  String.raw`([A-Za-z]:[\\/][^"'<>()\n|*?=]+?\.(?:${KNOWN_FILE_EXT})(?::\d+|#L\d+)?)`,
  'gi',
);

export type WorkspaceFileLinkTarget = {
  path: string;
  line?: number;
  kind: 'workspace-relative' | 'absolute';
};

export function xopcSettingsUrlToRoute(raw: string): string | null {
  try {
    const u = new URL(raw);
    if (u.protocol !== 'xopc:' || u.hostname !== 'settings') return null;
    const path = u.pathname === '/' ? '' : u.pathname;
    return `/settings${path}${u.search}${u.hash}`;
  } catch {
    return null;
  }
}

export function xopcWorkspaceFileUrlToHref(raw: string): string | null {
  try {
    const u = new URL(raw);
    if (u.protocol !== 'xopc:' || u.hostname !== 'workspace' || u.pathname !== '/file') return null;
    if (!u.searchParams.get('path')?.trim()) return null;
    return `/xopc/workspace/file${u.search}${u.hash}`;
  } catch {
    return null;
  }
}

function xopcUrlToInternalHref(raw: string): string {
  const reference = parseProductReferenceDeepLink(raw);
  const productRoute = reference
    ? productReferenceOpenRoute({
      ...reference,
      title: reference.id,
      capabilities: ['open'],
    })
    : null;
  if (productRoute) return `#${productRoute}`;
  return xopcSettingsUrlToRoute(raw)
    ?? xopcWorkspaceFileUrlToHref(raw)
    ?? raw;
}

export function rewriteXopcSettingsLinksInMarkdown(markdown: string): string {
  const xopcUrlPattern = String.raw`xopc:\/\/(?:settings|workspace\/file|open\?)[^\s[\]()<>"']*`;
  const markdownLinkPattern = new RegExp(String.raw`\[([^\]\n]*)\]\((${xopcUrlPattern})\)`, 'gi');
  const bareUrlPattern = new RegExp(xopcUrlPattern, 'gi');
  const rewrittenLinks = markdown.replace(markdownLinkPattern, (_match, label: string, raw: string) => {
    const normalizedLabel = /^xopc:\/\//i.test(label.trim()) ? 'Open in xopc' : label;
    return `[${normalizedLabel}](${xopcUrlToInternalHref(raw)})`;
  });
  return rewrittenLinks.replace(bareUrlPattern, xopcUrlToInternalHref);
}

export function parseWorkspaceFileLinkTarget(raw: string): WorkspaceFileLinkTarget | null {
  let path = raw.trim();
  if (!path) return null;

  if (path.startsWith('xopc://workspace/file') || path.startsWith('/xopc/workspace/file')) {
    try {
      const u = path.startsWith('/xopc/')
        ? new URL(path, 'https://xopc.local')
        : new URL(path);
      const paramPath = u.searchParams.get('path')?.trim() ?? '';
      if (!paramPath) return null;
      path = paramPath;
      const lineParam = Number(u.searchParams.get('line') ?? '');
      const fromParam = Number.isFinite(lineParam) && lineParam > 0 ? Math.floor(lineParam) : undefined;
      return normalizeWorkspaceFilePath(path, fromParam);
    } catch {
      return null;
    }
  }

  const absolute = normalizeAbsoluteFilePath(path);
  if (absolute) return absolute;

  if (/^[a-z][a-z0-9+.-]*:/i.test(path)) return null;
  if (path.startsWith('/') || path.startsWith('\\') || path.includes('..')) return null;
  return normalizeWorkspaceFilePath(path);
}

export function findWorkspaceRelativeFileMentions(text: string): WorkspaceFileLinkTarget[] {
  return collectFileMentionMatches(text).map((m) => m.target);
}

function normalizeWorkspaceFilePath(raw: string, lineFromParam?: number): WorkspaceFileLinkTarget | null {
  let path = raw.trim().replace(/\\/g, '/');
  if (!path || path.includes('..')) return null;

  let line = lineFromParam;
  const hashLine = path.match(/#L(\d+)$/i);
  if (hashLine?.[1]) {
    line = Number(hashLine[1]);
    path = path.slice(0, -hashLine[0].length);
  } else {
    const colonLine = path.match(/:(\d+)$/);
    if (colonLine?.[1]) {
      line = Number(colonLine[1]);
      path = path.slice(0, -colonLine[0].length);
    }
  }

  path = path.replace(/^\.\//, '');
  if (!path || path.startsWith('/') || /^[A-Za-z]:/.test(path)) return null;
  if (!new RegExp(String.raw`\.(?:${KNOWN_FILE_EXT})$`, 'i').test(path)) return null;
  return {
    path,
    line: Number.isFinite(line) && line && line > 0 ? Math.floor(line) : undefined,
    kind: 'workspace-relative',
  };
}

function normalizeAbsoluteFilePath(raw: string): WorkspaceFileLinkTarget | null {
  let path = raw.trim().replace(/\\/g, '/');
  if (!path) return null;
  if (/^[A-Za-z]:\/{2,}/.test(path)) return null;
  const isAbs = path.startsWith('/') || /^[A-Za-z]:\//.test(path);
  if (!isAbs) return null;

  let line: number | undefined;
  const hashLine = path.match(/#L(\d+)$/i);
  if (hashLine?.[1]) {
    line = Number(hashLine[1]);
    path = path.slice(0, -hashLine[0].length);
  } else {
    const colonLine = path.match(/:(\d+)$/);
    if (colonLine?.[1]) {
      line = Number(colonLine[1]);
      path = path.slice(0, -colonLine[0].length);
    }
  }

  if (!new RegExp(String.raw`\.(?:${KNOWN_FILE_EXT})$`, 'i').test(path)) return null;
  return {
    path,
    line: Number.isFinite(line) && line && line > 0 ? Math.floor(line) : undefined,
    kind: 'absolute',
  };
}

type FileMentionMatch = {
  raw: string;
  start: number;
  end: number;
  target: WorkspaceFileLinkTarget;
};

function collectFileMentionMatches(text: string): FileMentionMatch[] {
  const candidates: FileMentionMatch[] = [];
  const patterns = [UNIX_ABSOLUTE_FILE_RE, WIN_ABSOLUTE_FILE_RE, WORKSPACE_RELATIVE_FILE_RE];

  for (const re of patterns) {
    re.lastIndex = 0;
    let m: RegExpExecArray | null;
    while ((m = re.exec(text)) !== null) {
      const raw = m[1];
      if (!raw) continue;
      const start = m.index;
      const end = start + raw.length;
      const before = text[start - 1] ?? '';
      if (before === ':' || before === '@') continue;
      const target = parseWorkspaceFileLinkTarget(raw);
      if (!target) continue;
      if (target.kind === 'workspace-relative' && before === '/') continue;
      candidates.push({ raw, start, end, target });
    }
  }

  candidates.sort((a, b) => a.start - b.start || b.end - a.end);
  const out: FileMentionMatch[] = [];
  let coveredUntil = -1;
  for (const candidate of candidates) {
    if (candidate.start < coveredUntil) continue;
    out.push(candidate);
    coveredUntil = candidate.end;
  }
  return out;
}

function shouldSkipTextNode(node: Text): boolean {
  const parent = node.parentElement;
  if (!parent) return true;
  return Boolean(parent.closest('a, code, pre, kbd, samp, textarea, script, style, [data-xopc-inline-file]'));
}

export function linkWorkspaceFileMentions(root: HTMLElement): void {
  const doc = root.ownerDocument;
  const walker = doc.createTreeWalker(root, NodeFilter.SHOW_TEXT, {
    acceptNode(node) {
      if (!(node instanceof Text)) return NodeFilter.FILTER_REJECT;
      if (shouldSkipTextNode(node)) return NodeFilter.FILTER_REJECT;
      return collectFileMentionMatches(node.data).length > 0
        ? NodeFilter.FILTER_ACCEPT
        : NodeFilter.FILTER_REJECT;
    },
  });

  const nodes: Text[] = [];
  let next: Node | null;
  while ((next = walker.nextNode())) {
    nodes.push(next as Text);
  }

  for (const node of nodes) {
    const text = node.data;
    const matches = collectFileMentionMatches(text);
    if (matches.length === 0) continue;
    const frag = doc.createDocumentFragment();
    let cursor = 0;
    for (const match of matches) {
      if (match.start > cursor) {
        frag.appendChild(doc.createTextNode(text.slice(cursor, match.start)));
      }
      const a = doc.createElement('a');
      a.href = '#';
      a.className = 'markdown-file-link';
      a.dataset.xopcFilePath = match.target.path;
      a.dataset.xopcFileKind = match.target.kind;
      if (match.target.line) a.dataset.xopcLine = String(match.target.line);
      a.textContent = match.raw;
      frag.appendChild(a);
      cursor = match.end;
    }
    if (cursor === 0) continue;
    if (cursor < text.length) {
      frag.appendChild(doc.createTextNode(text.slice(cursor)));
    }
    node.parentNode?.replaceChild(frag, node);
  }
}

/** Marks explicit absolute HTTP(S) links to open separately; app-relative links stay in-window. */
export function openHttpLinksInNewTab(root: HTMLElement): void {
  for (const anchor of root.querySelectorAll<HTMLAnchorElement>('a[href]')) {
    const href = anchor.getAttribute('href');
    if (!href || !/^https?:\/\//i.test(href)) continue;
    try {
      const url = new URL(href);
      if (url.protocol !== 'http:' && url.protocol !== 'https:') continue;
      anchor.target = '_blank';
      const rel = new Set(anchor.rel.split(/\s+/).filter(Boolean));
      rel.add('noopener');
      rel.add('noreferrer');
      anchor.rel = [...rel].join(' ');
    } catch {
      /* Ignore malformed URLs. */
    }
  }
}
