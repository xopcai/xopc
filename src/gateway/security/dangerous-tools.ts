/**
 * Tools denied via Gateway HTTP tool invoke endpoints by default.
 *
 * These are high-risk because they enable command execution, file mutation,
 * session orchestration, or control-plane actions that don't belong on a
 * non-interactive HTTP surface.
 */
export const DEFAULT_GATEWAY_HTTP_TOOL_DENY: readonly string[] = [
  // Direct command execution — immediate RCE surface
  'exec',
  // Arbitrary child process creation
  'spawn',
  // Shell command execution
  'shell',
  // Arbitrary file mutation on the host
  'fs_write',
  // Arbitrary file deletion on the host
  'fs_delete',
  // Arbitrary file move/rename on the host
  'fs_move',
  // Patch application can rewrite arbitrary files
  'apply_patch',
  // Session orchestration — spawning agents remotely is RCE
  'sessions_spawn',
  // Cross-session injection — message injection across sessions
  'sessions_send',
  // Persistent automation control plane — can create/update/remove scheduled runs
  'cron',
  // Gateway control plane — prevents gateway reconfiguration via HTTP
  'gateway',
] as const;

const DANGEROUS_TOOL_SET: ReadonlySet<string> = new Set(DEFAULT_GATEWAY_HTTP_TOOL_DENY);

/**
 * Check whether a tool name is in the default HTTP deny list.
 */
export function isDangerousHttpTool(toolName: string): boolean {
  return DANGEROUS_TOOL_SET.has(toolName.toLowerCase());
}

/**
 * Filter a list of tool names, removing those on the HTTP deny list.
 * Returns only the safe tools.
 */
export function filterDangerousHttpTools(toolNames: string[]): {
  allowed: string[];
  denied: string[];
} {
  const allowed: string[] = [];
  const denied: string[] = [];
  for (const name of toolNames) {
    if (isDangerousHttpTool(name)) {
      denied.push(name);
    } else {
      allowed.push(name);
    }
  }
  return { allowed, denied };
}
