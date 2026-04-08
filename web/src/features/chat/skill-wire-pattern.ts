/**
 * `/skill:id` wire tokens use the same character rules as server skill ids. Using `[^\s]+` incorrectly
 * merges following text (e.g. CJK) into the skill name when there is no space after the pill.
 *
 * @see `src/agent/skills/managed-store.ts` SKILL_ID_RE
 */
export const SKILL_ID_IN_WIRE = '[a-zA-Z0-9](?:[a-zA-Z0-9._-]{0,62})';

/** `/skill:` + valid id; group 1 = id */
export const SKILL_WIRE_TOKEN_RE = new RegExp(`\\/skill:(${SKILL_ID_IN_WIRE})`, 'g');

/** Fresh RegExp (global regexes retain `lastIndex` across calls). */
export function skillWireTokenRe(): RegExp {
  return new RegExp(SKILL_WIRE_TOKEN_RE.source, 'g');
}

/** `head` ends with `/skill:id` only */
export const SKILL_WIRE_TRAILING_PLAIN_RE = new RegExp(`(\\/skill:${SKILL_ID_IN_WIRE})$`);

/** EOW: last `/skill:id` plus trailing spaces */
export const SKILL_WIRE_TRAILING_EOW_WS_RE = new RegExp(`(\\/skill:${SKILL_ID_IN_WIRE})([ \\t\\f\\v]*)$`);
