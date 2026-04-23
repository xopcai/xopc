export const FILE_PATH_CHARS = 'a-zA-Z0-9_./-';

/** Characters allowed in workspace-relative POSIX paths in wire text. */
export const FILE_PATH_IN_WIRE = `[${FILE_PATH_CHARS}]+`;

/** `@file:` + path; group 1 = path (file or directory with trailing `/`). */
export const FILE_WIRE_TOKEN_RE = new RegExp(`@file:(${FILE_PATH_IN_WIRE})`, 'g');

export const FILE_WIRE_TRAILING_PLAIN_RE = new RegExp(`(@file:[${FILE_PATH_CHARS}]+)$`);

export const FILE_WIRE_TRAILING_EOW_WS_RE = new RegExp(`(@file:[${FILE_PATH_CHARS}]+)([ \\t\\f\\v]*)$`);

export function fileWireTokenRe(): RegExp {
  return new RegExp(FILE_WIRE_TOKEN_RE.source, 'g');
}
