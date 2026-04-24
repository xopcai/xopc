/**
 * Workspace-relative paths in `@file:` wire text.
 * - Unquoted: Unicode + usual path chars (no whitespace).
 * - Quoted: "…" when the path contains spaces etc.; inner `"` and `\` escaped as `\"` and `\\`.
 */
const FILE_PATH_CHAR_CLASS = String.raw`a-zA-Z0-9_./\-\p{L}\p{N}`;

/** Character class source (for RegExp fragments). */
export const FILE_PATH_CHAR_CLASS_SRC = FILE_PATH_CHAR_CLASS;

/** Unquoted path segment (no spaces). */
export const FILE_PATH_UNQUOTED_IN_WIRE = `[${FILE_PATH_CHAR_CLASS}]+`;

/** Inside quotes: any char except unescaped " or \, or \-escape (non-capturing). */
const QUOTED_PATH_INNER_NC = String.raw`(?:[^"\\]|\\.)*`;

/** Capturing variant for token group 1. */
const QUOTED_PATH_INNER_CAP = String.raw`((?:[^"\\]|\\.)*)`;

const UNQUOTED_ONLY = new RegExp(`^[${FILE_PATH_CHAR_CLASS}]+$`, 'u');

export function unescapeQuotedFileWire(body: string): string {
  return body.replace(/\\(.)/g, (_: string, ch: string) => ch);
}

/**
 * @file: + path; group 1 = quoted inner (without quotes), group 2 = unquoted path.
 * Use pathFromFileWireMatch.
 */
export const FILE_WIRE_TOKEN_RE = new RegExp(
  `@file:(?:"${QUOTED_PATH_INNER_CAP}"|(${FILE_PATH_UNQUOTED_IN_WIRE}))`,
  'gu',
);

export const FILE_WIRE_TRAILING_PLAIN_RE = new RegExp(
  `(@file:(?:"${QUOTED_PATH_INNER_NC}"|${FILE_PATH_UNQUOTED_IN_WIRE}))$`,
  'u',
);

export const FILE_WIRE_TRAILING_EOW_WS_RE = new RegExp(
  `(@file:(?:"${QUOTED_PATH_INNER_NC}"|${FILE_PATH_UNQUOTED_IN_WIRE}))([ \\t\\f\\v]*)$`,
  'u',
);

/** After @file:, for end-of-string / boundary checks. */
export const FILE_WIRE_TAIL_BODY = `(?:"${QUOTED_PATH_INNER_NC}"|${FILE_PATH_UNQUOTED_IN_WIRE})`;

export function wireTextEndsWithCompleteFileToken(text: string): boolean {
  const i = text.lastIndexOf('@file:');
  if (i === -1) return false;
  return new RegExp(`^@file:${FILE_WIRE_TAIL_BODY}$`, 'u').test(text.slice(i));
}

export function pathFromFileWireMatch(m: RegExpMatchArray): string {
  const unquoted = m[2];
  if (unquoted != null && unquoted !== '') return unquoted;
  const q = m[1];
  return q != null ? unescapeQuotedFileWire(q) : '';
}

export function formatFilePathForWire(path: string): string {
  if (UNQUOTED_ONLY.test(path)) return path;
  const body = path.replace(/\\/g, '\\\\').replace(/"/g, '\\"');
  return `"${body}"`;
}

export function fileWireTokenRe(): RegExp {
  return new RegExp(FILE_WIRE_TOKEN_RE.source, 'gu');
}

/** `^@file:…` for composer token consumption (groups match FILE_WIRE_TOKEN_RE). */
export const FILE_COMPOSER_HEAD_RE = new RegExp(
  `^@file:(?:"${QUOTED_PATH_INNER_CAP}"|(${FILE_PATH_UNQUOTED_IN_WIRE}))`,
  'u',
);

/** @deprecated use FILE_PATH_UNQUOTED_IN_WIRE */
export const FILE_PATH_IN_WIRE = FILE_PATH_UNQUOTED_IN_WIRE;
