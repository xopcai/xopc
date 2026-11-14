/**
 * Execution policy layer — unified entry point for sandbox enforcement.
 *
 * Integrates:
 * - Environment variable sanitization (sanitize-env-vars.ts)
 * - Path safety validation (path-policy.ts)
 * - Command injection detection (command-validator.ts)
 *
 * Tool implementations call `evaluateExecPolicy()` before spawning processes
 * and `evaluateFilePolicy()` before file read/write/edit operations.
 */

import { isAbsolute, resolve } from 'node:path';

import { createLogger } from '../../utils/logger.js';
import { getExecutionAuthority } from '../../infra/execution-authority.js';
import { getDelegationScope } from '../orchestration/delegation-scope.js';
import { prepareSafeToolEnv } from './sanitize-env-vars.js';
import { validatePath, validateWritePath } from './path-policy.js';
import { validateCommand, auditCommand } from './command-validator.js';
import type { ExecPolicyResult, SandboxConfig, PathValidationResult } from './types.js';
import { DEFAULT_SANDBOX_CONFIG } from './types.js';

const log = createLogger('Sandbox:ExecPolicy');

/**
 * Evaluate whether a shell command execution is allowed under the current sandbox policy.
 *
 * Checks (in order):
 * 1. Command injection / dangerous patterns
 * 2. Working directory path safety
 * 3. Environment variable sanitization
 */
export function evaluateExecPolicy(params: {
  command: string;
  cwd: string;
  workspaceRoot?: string;
  allowOutsideWorkspace?: boolean;
  config?: Partial<SandboxConfig>;
  allowedEnvVars?: string[];
}): ExecPolicyResult {
  const config = { ...DEFAULT_SANDBOX_CONFIG, ...params.config };

  if (config.mode === 'off') {
    return {
      allowed: true,
      sanitizedEnv: prepareSafeToolEnv(process.env, { allowedVars: params.allowedEnvVars }),
      effectiveCwd: params.cwd,
      timeoutMs: config.maxExecutionTimeMs,
    };
  }

  // 1. Command validation
  const commandResult = validateCommand(params.command);
  if (!commandResult.allowed) {
    log.warn(
      { command: params.command.slice(0, 120), reason: commandResult.reason },
      'Command blocked by sandbox policy',
    );
    return {
      allowed: false,
      blockedBy: 'command',
      reason: commandResult.reason,
      sanitizedEnv: {},
      effectiveCwd: params.cwd,
      timeoutMs: config.maxExecutionTimeMs,
    };
  }

  // Log warnings for medium-severity commands
  if (commandResult.reason) {
    log.info(
      { command: params.command.slice(0, 120), warning: commandResult.reason },
      'Command allowed with warning',
    );
  }

  // 2. CWD path validation
  const allowOutsideWorkspace = params.allowOutsideWorkspace
    && !getExecutionAuthority() && !getDelegationScope()?.restrictToWorkspace;
  const cwdResult = validatePath(params.cwd, {
    allowedRoots: config.allowedRoots.length > 0 ? config.allowedRoots
      : allowOutsideWorkspace ? undefined : [params.workspaceRoot ?? params.cwd],
    extraBlockedPaths: config.blockedPaths,
  });
  if (!cwdResult.allowed) {
    log.warn({ cwd: params.cwd, reason: cwdResult.reason }, 'CWD blocked by path policy');
    return {
      allowed: false,
      blockedBy: 'cwd',
      reason: `Working directory blocked: ${cwdResult.reason}`,
      sanitizedEnv: {},
      effectiveCwd: params.cwd,
      timeoutMs: config.maxExecutionTimeMs,
    };
  }

  // 3. Environment sanitization
  const sanitizedEnv = prepareSafeToolEnv(process.env, {
    allowedVars: params.allowedEnvVars ?? config.allowedEnvVars,
  });

  return {
    allowed: true,
    reason: commandResult.reason,
    sanitizedEnv,
    effectiveCwd: cwdResult.canonicalPath ?? params.cwd,
    timeoutMs: config.maxExecutionTimeMs,
  };
}

/**
 * Evaluate whether a file operation (read/write/edit/delete) is allowed.
 */
export function evaluateFilePolicy(params: {
  operation: 'read' | 'write' | 'edit' | 'delete';
  path: string;
  workspaceRoot: string;
  allowOutsideWorkspace?: boolean;
  config?: Partial<SandboxConfig>;
}): PathValidationResult {
  const config = { ...DEFAULT_SANDBOX_CONFIG, ...params.config };

  if (config.mode === 'off') {
    return { allowed: true };
  }

  const allowOutsideWorkspace = params.allowOutsideWorkspace
    && !getExecutionAuthority() && !getDelegationScope()?.restrictToWorkspace;
  const pathOptions = {
    allowedRoots: config.allowedRoots.length > 0 ? config.allowedRoots
      : allowOutsideWorkspace ? undefined : [params.workspaceRoot],
    extraBlockedPaths: config.blockedPaths,
  };
  const result = params.operation === 'read'
    ? validatePath(isAbsolute(params.path) ? params.path : resolve(params.workspaceRoot, params.path), pathOptions)
    : validateWritePath(params.path, params.workspaceRoot, pathOptions);

  if (!result.allowed) {
    log.warn(
      { operation: params.operation, path: params.path, reason: result.reason },
      'File operation blocked by sandbox policy',
    );
  }

  return result;
}

/**
 * Generate a full audit report for a command — useful for security logging.
 */
export function auditExecRequest(params: {
  command: string;
  cwd: string;
}): { findings: { severity: 'critical' | 'high' | 'medium'; reason: string }[] } {
  return { findings: auditCommand(params.command) };
}
