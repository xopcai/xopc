import { FILE_PATH_CHARS, FILE_PATH_IN_WIRE } from '@/features/chat/file-wire-pattern';

/** `@doc:` + workspace-relative path (Markdown / docs). */
export const DOC_WIRE_TOKEN_RE = new RegExp(`@doc:(${FILE_PATH_IN_WIRE})`, 'g');

export const DOC_WIRE_TRAILING_PLAIN_RE = new RegExp(`(@doc:[${FILE_PATH_CHARS}]+)$`);

export const DOC_WIRE_TRAILING_EOW_WS_RE = new RegExp(`(@doc:[${FILE_PATH_CHARS}]+)([ \\t\\f\\v]*)$`);

export function docWireTokenRe(): RegExp {
  return new RegExp(DOC_WIRE_TOKEN_RE.source, 'g');
}

const URL_BODY = 'https?://[^\\s]+';

export const URL_WIRE_TOKEN_RE = new RegExp(`@url:(${URL_BODY})`, 'g');

export const URL_WIRE_TRAILING_PLAIN_RE = new RegExp(`(@url:${URL_BODY})$`);

export const URL_WIRE_TRAILING_EOW_WS_RE = new RegExp(`(@url:${URL_BODY})([ \\t\\f\\v]*)$`);

export function urlWireTokenRe(): RegExp {
  return new RegExp(URL_WIRE_TOKEN_RE.source, 'g');
}

/** Simple identifier for `@symbol:` (expanded server-side via ripgrep). */
export const SYMBOL_ID_IN_WIRE = '[a-zA-Z0-9_][a-zA-Z0-9_.]*';

export const SYMBOL_WIRE_TOKEN_RE = new RegExp(`@symbol:(${SYMBOL_ID_IN_WIRE})`, 'g');

export const SYMBOL_WIRE_TRAILING_PLAIN_RE = new RegExp(`(@symbol:${SYMBOL_ID_IN_WIRE})$`);

export const SYMBOL_WIRE_TRAILING_EOW_WS_RE = new RegExp(`(@symbol:${SYMBOL_ID_IN_WIRE})([ \\t\\f\\v]*)$`);

export function symbolWireTokenRe(): RegExp {
  return new RegExp(SYMBOL_WIRE_TOKEN_RE.source, 'g');
}

export const DOC_HEAD_RE = new RegExp(`^@doc:(${FILE_PATH_IN_WIRE})`);
export const URL_HEAD_RE = new RegExp(`^@url:(${URL_BODY})`);
export const SYMBOL_HEAD_RE = new RegExp(`^@symbol:(${SYMBOL_ID_IN_WIRE})`);
