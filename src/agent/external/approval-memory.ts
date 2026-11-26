import type { ExternalInteractionRequest } from './types.js';

const DANGEROUS_COMMAND_PATTERNS: ReadonlyArray<RegExp> = [
  /\brm\s+-[a-zA-Z]*r[a-zA-Z]*f[a-zA-Z]*\s+(?:\/|~|\$HOME|\.\.)(?:\s|$)/,
  /\brm\s+-[a-zA-Z]*f[a-zA-Z]*r[a-zA-Z]*\s+(?:\/|~|\$HOME|\.\.)(?:\s|$)/,
  /\bgit\s+push\s+(?:--force|-f|--force-with-lease)\b/,
  /\bgit\s+reset\s+--hard\b/,
  /\bgit\s+clean\s+-[a-zA-Z]*f[a-zA-Z]*d/,
  /\b(?:mkfs|dd\s+if=|shutdown|reboot|halt)\b/,
  /\bchmod\s+-R\s+777\s+\//,
  /:\(\)\s*\{\s*:\s*\|\s*:\s*&\s*\}\s*;\s*:/,
];

const sessionApprovals = new Map<string, Set<string>>();

function sessionKey(conversationId: string, transcriptId: string): string {
  return `${conversationId}::${transcriptId}`;
}

/** Detect high-risk shell commands that must never be silently auto-approved by session memory. */
export function isDangerousExternalCommand(command: string): boolean {
  const trimmed = command.trim();
  if (!trimmed) return false;
  return DANGEROUS_COMMAND_PATTERNS.some((pattern) => pattern.test(trimmed));
}

/** Compute a stable, coarse-grained signature for remembering session-scoped approvals. */
export function approvalSignatureForRequest(request: ExternalInteractionRequest): string | null {
  if (request.kind !== 'approval') return null;
  if (request.actionKind === 'file_change') {
    return 'file_change';
  }
  if (request.actionKind === 'command') {
    if (isDangerousExternalCommand(request.question)) return null;
    // Strip leading env assignments (`FOO=1 bar`) and capture the executable token.
    const tokens = request.question
      .trim()
      .split(/\s+/)
      .filter((t) => t && !/^[A-Za-z_][A-Za-z0-9_]*=/.test(t));
    const bin = tokens[0]?.replace(/^.*\//, '').toLowerCase();
    if (!bin) return null;
    // Subcommand-aware scope for common package/git CLIs so approving `git status` doesn't approve `git push`.
    if ((bin === 'git' || bin === 'pnpm' || bin === 'npm' || bin === 'yarn' || bin === 'cargo' || bin === 'docker') && tokens[1]) {
      const sub = tokens[1].toLowerCase();
      if (/^[a-z0-9_-]+$/.test(sub)) return `command:${bin}:${sub}`;
    }
    return `command:${bin}`;
  }
  const title = request.title?.trim().toLowerCase();
  return title ? `other:${title}` : null;
}

/** Check whether an external approval request was already approved for this session. */
export function isExternalApprovalRemembered(
  conversationId: string,
  transcriptId: string,
  request: ExternalInteractionRequest,
): boolean {
  const sig = approvalSignatureForRequest(request);
  if (!sig) return false;
  return sessionApprovals.get(sessionKey(conversationId, transcriptId))?.has(sig) ?? false;
}

/** Remember a user's "Approve for session" choice for the active transcript. */
export function rememberExternalSessionApproval(
  conversationId: string,
  transcriptId: string,
  request: ExternalInteractionRequest,
): boolean {
  const sig = approvalSignatureForRequest(request);
  if (!sig) return false;
  const key = sessionKey(conversationId, transcriptId);
  let set = sessionApprovals.get(key);
  if (!set) {
    set = new Set<string>();
    sessionApprovals.set(key, set);
  }
  set.add(sig);
  return true;
}

/** Clear all remembered session approvals for a conversation (called on reset/delete). */
export function clearExternalSessionApprovals(conversationId: string): void {
  const prefix = `${conversationId}::`;
  for (const key of sessionApprovals.keys()) {
    if (key.startsWith(prefix)) sessionApprovals.delete(key);
  }
}
