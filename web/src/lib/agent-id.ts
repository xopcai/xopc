/**
 * Agent id rules — keep in sync with `src/agent/agent-scope.ts` (`validateAgentIdForNewAgent`).
 */

const DEFAULT_AGENT_ID = 'main';
const VALID_ID_RE = /^[a-z0-9][a-z0-9_-]{0,63}$/i;
const INVALID_CHARS_RE = /[^a-z0-9_-]+/g;
const LEADING_DASH_RE = /^-+/;
const TRAILING_DASH_RE = /-+$/;

const STRICT_AGENT_ID_RE = /^[a-z0-9][a-z0-9_-]{0,63}$/;

const WINDOWS_RESERVED_AGENT_IDS = new Set<string>([
  'con',
  'prn',
  'aux',
  'nul',
  'com1',
  'com2',
  'com3',
  'com4',
  'com5',
  'com6',
  'com7',
  'com8',
  'com9',
  'lpt1',
  'lpt2',
  'lpt3',
  'lpt4',
  'lpt5',
  'lpt6',
  'lpt7',
  'lpt8',
  'lpt9',
]);

export function normalizeAgentId(value: string | undefined | null): string {
  const trimmed = (value ?? '').trim();
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

export function validateAgentIdForNewAgent(
  explicitId: string | undefined | null,
  displayNameForDerivation: string,
): { ok: true; agentId: string } | { ok: false; error: string } {
  const explicit = explicitId?.trim();
  if (explicit) {
    const id = explicit.toLowerCase();
    if (!STRICT_AGENT_ID_RE.test(id)) {
      return {
        ok: false,
        error:
          'Invalid agent id: use 1-64 characters; letters, digits, underscores, and hyphens only; start with a letter or digit.',
      };
    }
    if (id === DEFAULT_AGENT_ID) {
      return { ok: false, error: `"${DEFAULT_AGENT_ID}" is reserved` };
    }
    if (WINDOWS_RESERVED_AGENT_IDS.has(id)) {
      return { ok: false, error: `Agent id "${id}" is reserved (Windows device name).` };
    }
    return { ok: true, agentId: id };
  }

  const agentId = normalizeAgentId(displayNameForDerivation.trim());
  if (agentId === DEFAULT_AGENT_ID) {
    return {
      ok: false,
      error:
        'Display name cannot produce a valid agent folder id. Set an explicit Agent id (letters, digits, underscores, hyphens only).',
    };
  }
  if (WINDOWS_RESERVED_AGENT_IDS.has(agentId)) {
    return {
      ok: false,
      error: `That display name resolves to "${agentId}", which is reserved. Use a different display name or set an explicit Agent id.`,
    };
  }
  if (!STRICT_AGENT_ID_RE.test(agentId)) {
    return {
      ok: false,
      error:
        'Could not derive a folder-safe agent id from the display name. Set an explicit Agent id (letters, digits, underscores, hyphens only).',
    };
  }
  return { ok: true, agentId };
}
