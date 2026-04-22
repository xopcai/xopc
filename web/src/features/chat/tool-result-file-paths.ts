/** Extension list for files we offer preview links for. */
const KNOWN_FILE_EXT = String.raw`png|jpe?g|gif|webp|bmp|svg|pdf|docx?|xlsx?|pptx?|txt|md|json|html?|css|mjs?|cjs|js|ts|mp3|wav|ogg|m4a|mp4|mov|webm` as const;

function extensionPattern(): string {
  return `(?:${KNOWN_FILE_EXT})`;
}

/** From leading `/` to a known file extension (Unix absolute paths) */
const UNIX_FILE_PATH_RE = new RegExp(
  `(/[^\\s"'"<>|*?\\n]+?\\.(?:${extensionPattern()}))`,
  'gi',
);

const WIN_FILE_PATH_RE = new RegExp(
  `([A-Za-z]:[\\\\/][^"'\`<>*?\\n|]+?\\.(?:${extensionPattern()}))`,
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
    return /^\/(?:Users|usr|var|opt|tmp|home|root|System|private|dev|media|mnt|Volumes|data)[\\/\s]/i.test(
      t + '/',
    ) || /^\//.test(t);
  }
  if (/^[A-Za-z]:[\\/]/.test(t)) return true;
  if (t.startsWith('\\\\')) return true; // UNC
  return false;
}

function getFileName(path: string): string {
  const n = path.replace(/\\/g, '/').split('/').filter(Boolean);
  return n[n.length - 1] || path;
}

function pushPath(
  absolutePath: string,
  out: ExtractedFilePath[],
  fullText: string,
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

function collectPathsFromJson(obj: unknown, out: ExtractedFilePath[], fullText: string): void {
  if (typeof obj === 'string') {
    if (looksLikeAbsoluteFilePath(obj) && /.\.[a-z0-9]+$/i.test(obj.trim())) {
      const i = fullText.indexOf(obj);
      if (i >= 0) {
        pushPath(obj, out, fullText, i, i + obj.length);
      } else {
        pushPath(obj, out, fullText, 0, 0);
      }
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
    for (const val of Object.values(obj as Record<string, unknown>)) {
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

  scanTextForPaths(resultText, paths);

  const seen = new Set<string>();
  return paths.filter((p) => {
    const key = p.absolutePath;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}
