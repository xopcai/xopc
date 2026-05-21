/**
 * Command injection detection and dangerous command blocking.
 *
 * Enhances the basic checkShellSafety in prompt/safety.ts with deeper analysis:
 * - Shell metacharacter injection in arguments
 * - Dangerous command prefixes (destructive ops, credential exfiltration)
 * - Pipe-to-interpreter patterns (curl|bash, wget|sh, etc.)
 * - Credential / secret harvesting attempts
 */

import type { CommandValidationResult } from './types.js';

// ---------------------------------------------------------------------------
// Critical — always block, no override
// ---------------------------------------------------------------------------

const CRITICAL_PATTERNS: { pattern: RegExp; reason: string }[] = [
  // Destructive filesystem ops
  { pattern: /\brm\s+(-[a-zA-Z]*[rR][a-zA-Z]*\s+|--recursive\s+)\/(\s|$)/, reason: 'Recursive delete from root' },
  { pattern: /\brm\s+(-[a-zA-Z]*[rR][a-zA-Z]*\s+|--recursive\s+)~\//, reason: 'Recursive delete from home directory' },
  { pattern: /\bmkfs\b/, reason: 'Filesystem format command' },
  { pattern: /\bdd\s+.*\bof=\/dev\//, reason: 'Raw device write via dd' },
  { pattern: />\s*\/dev\/[hs]d/, reason: 'Redirect to block device' },

  // Pipe to interpreter — remote code execution
  { pattern: /\bcurl\b[^|]*\|\s*(ba)?sh\b/, reason: 'Pipe curl output to shell' },
  { pattern: /\bwget\b[^|]*\|\s*(ba)?sh\b/, reason: 'Pipe wget output to shell' },
  { pattern: /\bcurl\b[^|]*\|\s*python/, reason: 'Pipe curl output to python' },
  { pattern: /\bwget\b[^|]*\|\s*python/, reason: 'Pipe wget output to python' },
  { pattern: /\bcurl\b[^|]*\|\s*node\b/, reason: 'Pipe curl output to node' },
  { pattern: /\bcurl\b[^|]*\|\s*perl\b/, reason: 'Pipe curl output to perl' },

  // Credential harvesting
  { pattern: /\bcat\s+.*\/\.ssh\/id_/, reason: 'Read SSH private key' },
  { pattern: /\bcat\s+.*\/\.aws\/credentials/, reason: 'Read AWS credentials' },
  { pattern: /\bcat\s+.*\/\.gnupg\//, reason: 'Read GPG keyring' },
  { pattern: /\bcat\s+.*\/\.netrc/, reason: 'Read netrc credentials' },
  { pattern: /\bcat\s+.*\/etc\/shadow/, reason: 'Read shadow password file' },

  // Docker socket access
  { pattern: /\/var\/run\/docker\.sock/, reason: 'Docker socket access' },
  { pattern: /\bdocker\s+run\b.*--privileged/, reason: 'Privileged Docker container' },
];

// ---------------------------------------------------------------------------
// High — block by default, can be overridden in advanced mode
// ---------------------------------------------------------------------------

const HIGH_PATTERNS: { pattern: RegExp; reason: string }[] = [
  // Dangerous flags
  { pattern: /\bchmod\s+[0-7]*7[0-7]{2}\b/, reason: 'World-writable chmod' },
  { pattern: /\bchmod\s+.*[+]s\b/, reason: 'Set SUID/SGID bit' },
  { pattern: /\bchown\s+root\b/, reason: 'Change ownership to root' },

  // Network exfiltration patterns
  { pattern: /\bcurl\b.*--upload-file/, reason: 'File upload via curl' },
  { pattern: /\bcurl\b.*-T\s/, reason: 'File upload via curl -T' },
  { pattern: /\bnc\s+-[a-zA-Z]*l/, reason: 'Netcat listener (reverse shell)' },
  { pattern: /\bsocat\b.*\bexec\b/i, reason: 'Socat exec (reverse shell)' },

  // Process manipulation
  { pattern: /\bkill\s+-9\s+1\b/, reason: 'Kill init process' },
  { pattern: /\bkillall\b/, reason: 'Kill all processes by name' },

  // Crontab modification
  { pattern: /\bcrontab\s+-[erl]/, reason: 'Crontab modification' },

  // System service manipulation
  { pattern: /\bsystemctl\s+(start|stop|restart|enable|disable)\b/, reason: 'Systemd service manipulation' },
  { pattern: /\blaunchctl\s+(load|unload|start|stop)\b/, reason: 'macOS launchctl manipulation' },

  // Package manager with elevated privileges
  { pattern: /\bsudo\s+/, reason: 'Sudo command execution' },
  { pattern: /\bsu\s+-\s/, reason: 'Switch to root user' },
  { pattern: /\bdoas\s+/, reason: 'Doas command execution' },
];

// ---------------------------------------------------------------------------
// Medium — warn but allow
// ---------------------------------------------------------------------------

const MEDIUM_PATTERNS: { pattern: RegExp; reason: string }[] = [
  { pattern: /\brm\s+-[a-zA-Z]*[rR]/, reason: 'Recursive delete (non-root)' },
  { pattern: /\bmv\s+.*\s+\//, reason: 'Move file to root directory' },
  // Exclude common safe patterns like `chmod +x`, only warn on octal or broad ops
  { pattern: /\bchmod\s+(?!\+x\b)[0-7]{3,4}\b/, reason: 'Octal permission change' },
  { pattern: /\bgit\s+push\s+--force/, reason: 'Force push to git remote' },
  { pattern: /\bgit\s+reset\s+--hard/, reason: 'Hard git reset' },
];

// ---------------------------------------------------------------------------
// Shell metacharacter injection in command arguments
// ---------------------------------------------------------------------------

/**
 * Detect obvious shell injection patterns that might be embedded in
 * model-generated arguments (e.g. a filename containing "; rm -rf /").
 *
 * This is intentionally conservative — we only flag patterns that are
 * extremely unlikely in legitimate commands.
 */
const INJECTION_PATTERNS: { pattern: RegExp; reason: string }[] = [
  // Backtick containing dangerous commands (not benign subshells like `date` or `mktemp`)
  { pattern: /`[^`]*(curl|wget|nc|rm\s+-rf|dd\s+|mkfs)[^`]*`/, reason: 'Dangerous command inside backtick substitution' },
  // $() containing dangerous commands (allow benign like $(date), $(pwd), $(nproc))
  { pattern: /\$\([^)]*(curl|wget|nc|rm\s+-rf|dd\s+|mkfs)[^)]*\)/, reason: 'Dangerous command inside $() substitution' },
  // Semicolon-separated second command that is destructive
  { pattern: /;\s*(rm|dd|mkfs|curl|wget|nc)\b/, reason: 'Injected destructive command after semicolon' },
  // Newline injection
  { pattern: /\n\s*(rm|dd|mkfs|curl|wget|nc)\b/, reason: 'Newline-injected destructive command' },
];

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Validate a shell command against injection and dangerous-command patterns.
 *
 * Returns `{ allowed: false }` for critical/high severity issues.
 * Returns `{ allowed: true }` with a reason for medium severity (warning).
 */
export function validateCommand(command: string): CommandValidationResult {
  const trimmed = command.trim();

  if (!trimmed) {
    return { allowed: false, reason: 'Empty command', severity: 'medium' };
  }

  // --- Critical checks ---
  for (const { pattern, reason } of CRITICAL_PATTERNS) {
    if (pattern.test(trimmed)) {
      return { allowed: false, reason: `Critical: ${reason}`, severity: 'critical' };
    }
  }

  // --- Injection checks ---
  for (const { pattern, reason } of INJECTION_PATTERNS) {
    if (pattern.test(trimmed)) {
      return { allowed: false, reason: `Injection: ${reason}`, severity: 'critical' };
    }
  }

  // --- High severity checks ---
  for (const { pattern, reason } of HIGH_PATTERNS) {
    if (pattern.test(trimmed)) {
      return { allowed: false, reason: `Blocked: ${reason}`, severity: 'high' };
    }
  }

  // --- Medium severity checks (allow but flag) ---
  for (const { pattern, reason } of MEDIUM_PATTERNS) {
    if (pattern.test(trimmed)) {
      return { allowed: true, reason: `Warning: ${reason}`, severity: 'medium' };
    }
  }

  return { allowed: true };
}

/**
 * Extract a list of all matched warning/block reasons for audit logging.
 * Unlike `validateCommand`, this does not short-circuit on the first match.
 */
export function auditCommand(command: string): { severity: 'critical' | 'high' | 'medium'; reason: string }[] {
  const trimmed = command.trim();
  const findings: { severity: 'critical' | 'high' | 'medium'; reason: string }[] = [];

  for (const { pattern, reason } of CRITICAL_PATTERNS) {
    if (pattern.test(trimmed)) findings.push({ severity: 'critical', reason });
  }
  for (const { pattern, reason } of INJECTION_PATTERNS) {
    if (pattern.test(trimmed)) findings.push({ severity: 'critical', reason });
  }
  for (const { pattern, reason } of HIGH_PATTERNS) {
    if (pattern.test(trimmed)) findings.push({ severity: 'high', reason });
  }
  for (const { pattern, reason } of MEDIUM_PATTERNS) {
    if (pattern.test(trimmed)) findings.push({ severity: 'medium', reason });
  }

  return findings;
}
