/**
 * Mirrors server `normalizeAgentId` / default workspace layout (`resolveAgentWorkspaceDir`
 * when no per-agent workspace is set and no `agents.defaults.workspace`).
 */
const DEFAULT_AGENT_ID = 'main';
const VALID_ID_RE = /^[a-z0-9][a-z0-9_-]{0,63}$/i;
const INVALID_CHARS_RE = /[^a-z0-9_-]+/g;
const LEADING_DASH_RE = /^-+/;
const TRAILING_DASH_RE = /-+$/;

function normalizeAgentId(value: string): string {
  const trimmed = value.trim();
  if (!trimmed) {
    return DEFAULT_AGENT_ID;
  }
  const normalized = trimmed.toLowerCase();
  if (VALID_ID_RE.test(trimmed)) {
    return normalized;
  }
  return (
    normalized
      .replace(INVALID_CHARS_RE, '-')
      .replace(LEADING_DASH_RE, '')
      .replace(TRAILING_DASH_RE, '')
      .slice(0, 64) || DEFAULT_AGENT_ID
  );
}

/** Empty string if `name` is blank; else `~/.xopc/workspace-<agentId>`. */
export function suggestWorkspaceFromAgentName(name: string): string {
  const t = name.trim();
  if (!t) {
    return '';
  }
  const id = normalizeAgentId(t);
  return `~/.xopc/workspace-${id}`;
}
