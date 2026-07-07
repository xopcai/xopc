/**
 * Sandbox type definitions for Phase 1 process-level isolation.
 */

/** Controls how strictly the sandbox enforces isolation. */
export type SandboxMode = 'off' | 'basic' | 'container';

/** Result of path validation against the sandbox policy. */
export type PathValidationResult = {
  allowed: boolean;
  /** Canonical (symlink-resolved) path after validation. */
  canonicalPath?: string;
  reason?: string;
};

/** Result of command validation against injection patterns. */
export type CommandValidationResult = {
  allowed: boolean;
  reason?: string;
  /** Risk severity when blocked. */
  severity?: 'critical' | 'high' | 'medium';
};

/** Aggregated result from the exec policy layer. */
export type ExecPolicyResult = {
  allowed: boolean;
  reason?: string;
  sanitizedEnv: Record<string, string>;
  effectiveCwd: string;
  timeoutMs: number;
};

/** Sandbox configuration for an agent or workspace. */
export type SandboxConfig = {
  mode: SandboxMode;
  /** Directories where file operations and command execution are allowed. */
  allowedRoots: string[];
  /** Maximum execution time for commands (ms). */
  maxExecutionTimeMs: number;
  /** Maximum output size from commands (bytes). */
  maxOutputBytes: number;
  /** Paths that are always blocked regardless of allowedRoots. */
  blockedPaths?: string[];
  /** Env var names to pass through even if they match secret heuristics. */
  allowedEnvVars?: string[];
};

/** Default sandbox configuration. */
export const DEFAULT_SANDBOX_CONFIG: SandboxConfig = {
  mode: 'basic',
  allowedRoots: [],
  maxExecutionTimeMs: 300_000,
  maxOutputBytes: 50 * 1024,
};
