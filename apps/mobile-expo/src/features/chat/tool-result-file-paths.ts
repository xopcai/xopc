/** Extension list for files we offer preview links for. */
const KNOWN_FILE_EXT = String.raw`png|jpe?g|gif|webp|bmp|svg|pdf|docx?|xlsx?|pptx?|txt|md|json|html?|css|mjs?|cjs|js|ts|mp3|wav|ogg|m4a|mp4|mov|webm`;

function extensionPattern(): string {
  return `(?:${KNOWN_FILE_EXT})`;
}

/** From leading `/` to a known file extension (Unix absolute paths) */
const UNIX_FILE_PATH_RE = new RegExp(
  `(/[^\\s"'"<>|*?\\n]+?\\.(?:${extensionPattern()}))`,
  'gi',
);

/** Exclude `=` so code snippets (e.g. `s:\\n` + `result = …` + `args.json`) are not parsed as drive paths. */
const WIN_FILE_PATH_RE = new RegExp(
  `([A-Za-z]:[\\\\/][^"'\`<>*?\\n|=]+?\\.(?:${extensionPattern()}))`,
  'gi',
);

export interface ExtractedFilePath {
  /** The full path found in the text (as printed). */
  absolutePath: string;
  fileName: string;
  /** Inferred from extension; default `application/octet-stream` */
  mimeType: string;
  startIndex: number;
  endIndex: number;
  /**
   * When the tool result includes workspace-relative paths (e.g. `media/generated/...`),
   * use this for `raw` + preview without calling `resolve-path` (avoids 403 if host paths differ from session root).
   */
  workspaceRelativePath?: string;
}

const EXT_TO_MIME: Record<string, string> = {
  png: 'image/png',
  jpg: 'image/jpeg',
  jpeg: 'image/jpeg',
  gif: 'image/gif',
  webp: 'image/webp',
  bmp: 'image/bmp',
  svg: 'image/svg+xml',
  pdf: 'application/pdf',
  doc: 'application/msword',
  docx: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  xls: 'application/vnd.ms-excel',
  xlsx: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  ppt: 'application/vnd.ms-powerpoint',
  pptx: 'application/vnd.openxmlformats-officedocument.presentationml.presentation',
  txt: 'text/plain',
  md: 'text/markdown',
  json: 'application/json',
  html: 'text/html',
  htm: 'text/html',
  css: 'text/css',
  mjs: 'text/javascript',
  cjs: 'text/javascript',
  js: 'text/javascript',
  ts: 'text/typescript',
  mp3: 'audio/mpeg',
  wav: 'audio/wav',
  ogg: 'audio/ogg',
  m4a: 'audio/mp4',
  mp4: 'video/mp4',
  mov: 'video/quicktime',
  webm: 'video/webm',
};

export function mimeTypeFromFileName(name: string): string {
  const i = name.lastIndexOf('.');
  if (i < 0) return 'application/octet-stream';
  const ext = name.slice(i + 1).toLowerCase();
  return EXT_TO_MIME[ext] ?? 'application/octet-stream';
}

export function isImageMimeType(mime: string): boolean {
  return mime.startsWith('image/');
}

/**
 * Heuristic: absolute host path to a file (not URLs like `//cdn.example`).
 */
export function looksLikeAbsoluteFilePath(s: string): boolean {
  const t = s.trim();
  if (t.length < 4) return false;
  if (t.startsWith('//') && !t.startsWith('//Users')) return false;
  if (t.startsWith('http:') || t.startsWith('https:') || t.startsWith('data:') || t.startsWith('file://')) {
    return false;
  }
  if (t.startsWith('/')) {
    // Only treat as a host filesystem path when it uses a common Unix root prefix.
    // Do not use a bare `/^/` match: URL path segments like `/86683.html` inside
    // `https://…/86683.html` are extracted by the path scanner and must not open workspace preview.
    return /^\/(?:Users|usr|var|opt|tmp|home|root|System|private|dev|media|mnt|Volumes|data)(?:\/|[\s]|$)/i.test(
      t,
    );
  }
  if (/^[A-Za-z]:[\\/]/.test(t)) {
    const norm = t.replace(/\\/g, '/');
    // Reject `s://…` produced when WIN_FILE_PATH_RE matches inside `https://host/…` (`s:` + `/` + `/host…`).
    if (/^[A-Za-z]:\/{2,}/.test(norm)) return false;
    return true;
  }
  if (t.startsWith('\\\\')) return true; // UNC
  return false;
}

function getFileName(path: string): string {
  const n = path.replace(/\\/g, '/').split('/').filter(Boolean);
  return n[n.length - 1] || path;
}

/**
 * Strips `File written:` / `File edited:` / `Saved:` (write, edit, image tools — see e.g. `src/agent/tools/write.ts`).
 * When left on the line, `File written: /Users/…/a.md` does not start with `/` and was mis-tagged as a workspace-relative path.
 */
function stripFileToolResultLinePrefix(s: string): string {
  const t = s.trim();
  if (t.includes('\n') || t.includes('\r')) {
    return t;
  }
  return t
    .replace(/^(?:File written|File edited)\s*:\s*/i, '')
    .replace(/^Saved\s*:\s*/i, '')
    .trim();
}

/**
 * Strips a single `list_dir` / `read_multiple` line prefix (`f ` / `d ` / `? `).
 * See `src/agent/tools/list-dir.ts` (`${type} ${e.name}`).
 * Only single-line tool output is altered so multi-line blobs are left unchanged.
 */
function stripListDirLinePrefix(s: string): string {
  const t = s.trim();
  if (t.includes('\n') || t.includes('\r')) {
    return t;
  }
  const m = t.match(/^[fd?] (.+)$/);
  return m ? m[1].trim() : t;
}

function pushPath(
  absolutePath: string,
  out: ExtractedFilePath[],
  _fullText: string,
  startIndex: number,
  endIndex: number,
): void {
  const t = absolutePath.trim();
  if (!t || !looksLikeAbsoluteFilePath(t)) return;
  if (!/\.(png|jpe?g|gif|webp|bmp|svg|pdf|docx?|xlsx?|pptx?|txt|md|json|html?|css|mjs?|cjs|js|ts|mp3|wav|ogg|m4a|mp4|mov|webm)$/i.test(t)) {
    return;
  }
  const fileName = getFileName(t);
  out.push({
    absolutePath: t,
    fileName,
    mimeType: mimeTypeFromFileName(fileName),
    startIndex,
    endIndex,
  });
}

/** Align with `AGENT_PROFILE_MARKDOWN_SYSTEM_FILES` + BOOTSTRAP in xopc `src/agent/tools/tool-paths.ts`. */
const PROFILE_SYSTEM_MARKDOWN_NAME_LOWER = new Set(
  [
    'SOUL.md',
    'IDENTITY.md',
    'USER.md',
    'TOOLS.md',
    'AGENTS.md',
    'HEARTBEAT.md',
    'MEMORY.md',
    'BOOTSTRAP.md',
  ].map((f) => f.toLowerCase()),
);

export function isBareProfileMarkdownFileName(path: string): boolean {
  const b = getFileName(path.replace(/\\/g, '/'));
  if (!b || b === '.' || b === '..') return false;
  return PROFILE_SYSTEM_MARKDOWN_NAME_LOWER.has(b.toLowerCase());
}

/** Single-line `list_dir` / `read_multiple` entry (`f name`, `d name`, `? name`). */
function isListDirStyleEntryLine(s: string): boolean {
  const t = s.trim();
  if (t.includes('\n') || t.includes('\r')) return false;
  return /^[fd?] .+$/i.test(t);
}

function looksLikeWorkspaceRelativeFilePath(s: string): boolean {
  const t = s.trim().replace(/\\/g, '/');
  if (t.length < 4 || t.includes('..')) return false;
  if (t.startsWith('/') || /^[A-Za-z]:/i.test(t) || t.startsWith('\\\\')) return false;
  // `https://site.com/page.html` is a URL, not `media/foo.html`
  if (/^[a-z][a-z0-9+.-]*:/i.test(t)) return false;
  if (isBareProfileMarkdownFileName(t)) return false;
  return /\.(png|jpe?g|gif|webp|bmp|svg|pdf|docx?|xlsx?|pptx?|txt|md|json|html?|css|mjs?|cjs|js|ts|mp3|wav|ogg|m4a|mp4|mov|webm)$/i.test(
    t,
  );
}

function pushWorkspaceRelativePath(rel: string, out: ExtractedFilePath[], _fullText: string): void {
  const t = stripListDirLinePrefix(stripFileToolResultLinePrefix(rel))
    .trim()
    .replace(/\\/g, '/');
  if (!looksLikeWorkspaceRelativeFilePath(t)) {
    return;
  }
  const fileName = getFileName(t);
  out.push({
    absolutePath: `rel:${t}`,
    fileName,
    mimeType: mimeTypeFromFileName(fileName),
    workspaceRelativePath: t,
    startIndex: 0,
    endIndex: 0,
  });
}

function collectPathsFromJson(obj: unknown, out: ExtractedFilePath[], fullText: string): void {
  if (typeof obj === 'string') {
    if (isListDirStyleEntryLine(obj)) {
      const norm = stripListDirLinePrefix(stripFileToolResultLinePrefix(obj))
        .trim()
        .replace(/\\/g, '/');
      if (looksLikeAbsoluteFilePath(norm) && /\.[a-z0-9]+$/i.test(norm)) {
        const i = fullText.indexOf(obj);
        if (i >= 0) {
          pushPath(norm, out, fullText, i, i + obj.length);
        } else {
          pushPath(norm, out, fullText, 0, 0);
        }
      }
      return;
    }

    const norm = stripListDirLinePrefix(stripFileToolResultLinePrefix(obj))
      .trim()
      .replace(/\\/g, '/');
    if (looksLikeAbsoluteFilePath(norm) && /\.[a-z0-9]+$/i.test(norm)) {
      const i = fullText.indexOf(obj);
      if (i >= 0) {
        pushPath(norm, out, fullText, i, i + obj.length);
      } else {
        pushPath(norm, out, fullText, 0, 0);
      }
      return;
    }

    const before = out.length;
    scanTextForPaths(norm, out);
    if (out.length > before) {
      return;
    }

    if (looksLikeWorkspaceRelativeFilePath(norm)) {
      pushWorkspaceRelativePath(obj, out, fullText);
    }
    return;
  }
  if (Array.isArray(obj)) {
    for (const item of obj) {
      collectPathsFromJson(item, out, fullText);
    }
    return;
  }
  if (obj && typeof obj === 'object') {
    const rec = obj as Record<string, unknown>;
    const relArr = rec.workspaceRelativePaths;
    const hasRel =
      Array.isArray(relArr) && relArr.length > 0 && relArr.every((x) => typeof x === 'string');
    if (hasRel) {
      for (const s of relArr) {
        pushWorkspaceRelativePath(s, out, fullText);
      }
    }
    for (const [k, val] of Object.entries(rec)) {
      if (hasRel && k === 'paths') {
        continue;
      }
      collectPathsFromJson(val, out, fullText);
    }
  }
}

function scanTextForPaths(text: string, out: ExtractedFilePath[]): void {
  for (const re of [UNIX_FILE_PATH_RE, WIN_FILE_PATH_RE]) {
    re.lastIndex = 0;
    let m: RegExpExecArray | null;
    while ((m = re.exec(text)) !== null) {
      const cap = m[1];
      if (cap) {
        const start = m.index + (m[0].indexOf(cap) >= 0 ? m[0].indexOf(cap) : 0);
        pushPath(cap, out, text, start, start + cap.length);
      }
    }
  }
}

/** Path shape inside `**…**`, `` `…` ``, or `[text](…)` — same extensions as tool-result scanning. */
function assistantMarkdownRelativePathInner(): string {
  const ext = extensionPattern();
  return `(?:[A-Za-z0-9_.-]+\\/)*[A-Za-z0-9_.-]+\\.(?:${ext})`;
}

/**
 * Workspace-relative file paths mentioned in assistant markdown (bold, inline code, relative links).
 * Used so “两个文件已就绪：**`guide.html`**” style copy still gets preview chips beside the answer.
 */
export function extractWorkspaceRelativeMentionsFromAssistantMarkdown(fullText: string): ExtractedFilePath[] {
  const inner = assistantMarkdownRelativePathInner();
  const cap = `(${inner})`;
  const patterns = [
    new RegExp(`\\*\\*${cap}\\*\\*`, 'gi'),
    new RegExp('`' + cap + '`', 'gi'),
    new RegExp(`\\]\\(${cap}\\)`, 'gi'),
  ];
  const out: ExtractedFilePath[] = [];
  for (const re of patterns) {
    re.lastIndex = 0;
    let m: RegExpExecArray | null;
    while ((m = re.exec(fullText)) !== null) {
      const raw = m[1]?.trim().replace(/^<|>$/g, '');
      if (raw) {
        try {
          pushWorkspaceRelativePath(decodeURIComponent(raw), out, fullText);
        } catch {
          pushWorkspaceRelativePath(raw, out, fullText);
        }
      }
    }
  }
  const seen = new Set<string>();
  return out.filter((p) => {
    const k = p.workspaceRelativePath ?? p.absolutePath;
    if (seen.has(k)) return false;
    seen.add(k);
    return true;
  });
}

/** True if `abs` is the on-disk file for workspace-relative `rel` (dedupe "Saved: /.../a.png" vs "media/.../a.png"). */
export function absolutePathSameAsWorkspaceRelative(abs: string, rel: string): boolean {
  const a = abs.trim().replace(/\\/g, '/');
  const r = rel.trim().replace(/\\/g, '/').replace(/^\/+/, '');
  if (!r || a.length < r.length) return false;
  return a === r || a.endsWith(`/${r}`);
}

/**
 * When `workspaceRelativePath` is present, drop absolute-path entries that refer to the same file
 * (e.g. JSON has both `details.workspaceRelativePaths` and `content[].text` with "Saved: /abs/...").
 */
function dropAbsolutePathDupesCoveredByRel(paths: ExtractedFilePath[]): ExtractedFilePath[] {
  const rels = paths.map((p) => p.workspaceRelativePath).filter((x): x is string => Boolean(x));
  if (rels.length === 0) return paths;
  return paths.filter((p) => {
    if (p.workspaceRelativePath) return true;
    if (!looksLikeAbsoluteFilePath(p.absolutePath)) return true;
    return !rels.some((r) => absolutePathSameAsWorkspaceRelative(p.absolutePath, r));
  });
}

/**
 * Find absolute file system paths in tool result text (JSON or plain) for workspace preview links.
 */
export function extractFilePathsFromToolResult(resultText: string): ExtractedFilePath[] {
  const paths: ExtractedFilePath[] = [];
  if (!resultText?.trim()) {
    return [];
  }

  try {
    const parsed: unknown = JSON.parse(resultText);
    collectPathsFromJson(parsed, paths, resultText);
  } catch {
    // not valid JSON
  }

  const jsonHadWorkspaceRels = paths.some((p) => p.workspaceRelativePath);
  if (!jsonHadWorkspaceRels) {
    scanTextForPaths(resultText, paths);
  }

  const dedupedRel = dropAbsolutePathDupesCoveredByRel(paths);

  const seen = new Set<string>();
  return dedupedRel.filter((p) => {
    const key = p.absolutePath;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}
