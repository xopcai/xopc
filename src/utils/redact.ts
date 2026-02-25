/**
 * Sensitive Data Redaction Module
 * 
 * Automatically redacts sensitive information from logs:
 * - API keys (OpenAI, Anthropic, etc.)
 * - Tokens (GitHub, Slack, etc.)
 * - Passwords and secrets
 * - Private keys (PEM blocks)
 * 
 * Based on OpenClaw's redact.ts implementation.
 */

// =============================================================================
// Configuration
// =============================================================================

export type RedactMode = 'off' | 'tools' | 'always';

// Environment variable override
const ENV_REDACT_MODE = process.env.XOPCBOT_REDACT_MODE;

const DEFAULT_REDACT_MODE: RedactMode = 'tools';
const DEFAULT_REDACT_MIN_LENGTH = 18;
const DEFAULT_REDACT_KEEP_START = 6;
const DEFAULT_REDACT_KEEP_END = 4;

// Common sensitive data patterns
const DEFAULT_REDACT_PATTERNS: string[] = [
  // ENV-style assignments (KEY, TOKEN, SECRET, PASSWORD)
  String.raw`\b[A-Z0-9_]*(?:KEY|TOKEN|SECRET|PASSWORD|PASSWD)\b\s*[=:]\s*(["']?)([^\s"'\\]+)\1`,
  // JSON fields (apiKey, token, secret, password, accessToken, refreshToken)
  String.raw`"(?:apiKey|token|secret|password|passwd|accessToken|refreshToken|api_key|authToken)"\s*:\s*"([^"]+)"`,
  // CLI flags
  String.raw`--(?:api[-_]?key|token|secret|password|passwd)\s+(["']?)([^\s"']+)\1`,
  // Authorization headers
  String.raw`Authorization\s*[:=]\s*Bearer\s+([A-Za-z0-9._\-+=]+)`,
  String.raw`\bBearer\s+([A-Za-z0-9._\-+=]{18,})\b`,
  // PEM private keys
  String.raw`-----BEGIN [A-Z ]*PRIVATE KEY-----[\s\S]+?-----END [A-Z ]*PRIVATE KEY-----`,
  // OpenAI API keys
  String.raw`\b(sk-[A-Za-z0-9_-]{20,})\b`,
  // Anthropic API keys
  String.raw`\b(sk-ant-[A-Za-z0-9_-]{20,})\b`,
  // GitHub tokens
  String.raw`\b(ghp_[A-Za-z0-9]{20,})\b`,
  String.raw`\b(github_pat_[A-Za-z0-9_]{20,})\b`,
  String.raw`\b(gho_[A-Za-z0-9]{20,})\b`,
  // Slack tokens
  String.raw`\b(xox[baprs]-[A-Za-z0-9-]{10,})\b`,
  // Google API keys
  String.raw`\b(AIza[0-9A-Za-z\-_]{20,})\b`,
  // Anthropic/other keys
  String.raw`\b(sk-antapi[0-9a-zA-Z_-]{20,})\b`,
  // OpenRouter keys
  String.raw`\b(sk-or-v[0-9a-zA-Z_-]{20,})\b`,
  // MiniMax keys
  String.raw`\b(mmx-[A-Za-z0-9_-]{20,})\b`,
  // Kimi/Moonshot keys
  String.raw`\b(moonshot-[A-Za-z0-9_-]{20,})\b`,
  // Generic Bearer tokens
  String.raw`\b[Aa]ccess[-_]?[Tt]oken["']?\s*[:=]\s*["']?([A-Za-z0-9._\-+=]{20,})["']?`,
  // Generic refresh tokens
  String.raw`\b[Rr]efresh[-_]?[Tt]oken["']?\s*[:=]\s*["']?([A-Za-z0-9._\-+=]{20,})["']?`,
];

// =============================================================================
// Types
// =============================================================================

export interface RedactOptions {
  mode?: RedactMode;
  patterns?: string[];
}

// =============================================================================
// Internal Functions
// =============================================================================

function normalizeMode(value?: string): RedactMode {
  return value === 'off' ? 'off' : DEFAULT_REDACT_MODE;
}

function parsePattern(raw: string): RegExp | null {
  if (!raw.trim()) {
    return null;
  }
  const match = raw.match(/^\/(.+)\/([gimsuy]*)$/);
  try {
    if (match) {
      const flags = match[2].includes('g') ? match[2] : `${match[2]}g`;
      return new RegExp(match[1], flags);
    }
    return new RegExp(raw, 'gi');
  } catch {
    return null;
  }
}

function resolvePatterns(value?: string[]): RegExp[] {
  const source = value?.length ? value : DEFAULT_REDACT_PATTERNS;
  return source.map(parsePattern).filter((re): re is RegExp => Boolean(re));
}

function maskToken(token: string): string {
  if (token.length < DEFAULT_REDACT_MIN_LENGTH) {
    return '***';
  }
  const start = token.slice(0, DEFAULT_REDACT_KEEP_START);
  const end = token.slice(-DEFAULT_REDACT_KEEP_END);
  return `${start}…${end}`;
}

function redactPemBlock(block: string): string {
  const lines = block.split(/\r?\n/).filter(Boolean);
  if (lines.length < 2) {
    return '***';
  }
  return `${lines[0]}\n…redacted…\n${lines[lines.length - 1]}`;
}

function redactMatch(match: string, groups: string[]): string {
  if (match.includes('PRIVATE KEY-----')) {
    return redactPemBlock(match);
  }
  const token = groups.filter((value) => typeof value === 'string' && value.length > 0).at(-1) ?? match;
  const masked = maskToken(token);
  if (token === match) {
    return masked;
  }
  return match.replace(token, masked);
}

function redactText(text: string, patterns: RegExp[]): string {
  let next = text;
  for (const pattern of patterns) {
    next = next.replace(pattern, (...args: string[]) =>
      redactMatch(args[0], args.slice(1, args.length - 2)),
    );
  }
  return next;
}

function resolveConfigRedaction(): RedactOptions {
  // Check environment variable first
  if (ENV_REDACT_MODE) {
    return {
      mode: normalizeMode(ENV_REDACT_MODE),
      patterns: undefined,
    };
  }
  
  // Default to 'tools' mode
  return {
    mode: DEFAULT_REDACT_MODE,
    patterns: undefined,
  };
}

// =============================================================================
// Public API
// =============================================================================

/**
 * Redact sensitive data from text
 * 
 * @param text - Text to redact
 * @param options - Redaction options (optional)
 * @returns Redacted text
 */
export function redactSensitiveText(text: string, options?: RedactOptions): string {
  if (!text) {
    return text;
  }
  const resolved = options ?? resolveConfigRedaction();
  if (normalizeMode(resolved.mode) === 'off') {
    return text;
  }
  const patterns = resolvePatterns(resolved.patterns);
  if (!patterns.length) {
    return text;
  }
  return redactText(text, patterns);
}

/**
 * Redact sensitive data from object (recursive)
 * 
 * @param obj - Object to redact
 * @param options - Redaction options (optional)
 * @returns Redacted object
 */
export function redactObject<T>(obj: T, options?: RedactOptions): T {
  if (obj === null || obj === undefined) {
    return obj;
  }
  
  if (typeof obj === 'string') {
    return redactSensitiveText(obj, options) as T;
  }
  
  if (typeof obj === 'object') {
    if (Array.isArray(obj)) {
      return obj.map(item => redactObject(item, options)) as T;
    }
    
    const redacted: Record<string, unknown> = {};
    for (const [key, value] of Object.entries(obj as Record<string, unknown>)) {
      // Skip known sensitive keys
      const sensitiveKeys = [
        'apiKey', 'api_key', 'token', 'accessToken', 'refreshToken',
        'password', 'secret', 'privateKey', 'credential'
      ];
      
      if (sensitiveKeys.some(k => key.toLowerCase().includes(k.toLowerCase()))) {
        redacted[key] = '***REDACTED***';
      } else {
        redacted[key] = redactObject(value, options);
      }
    }
    return redacted as T;
  }
  
  return obj;
}

/**
 * Redact tool details (for logging)
 * 
 * Automatically skips sensitive fields in tool arguments
 * 
 * @param detail - Tool detail string
 * @returns Redacted detail
 */
export function redactToolDetail(detail: string): string {
  const resolved = resolveConfigRedaction();
  if (normalizeMode(resolved.mode) !== 'tools') {
    return detail;
  }
  return redactSensitiveText(detail, resolved);
}

/**
 * Check if redaction is enabled
 */
export function isRedactionEnabled(): boolean {
  const resolved = resolveConfigRedaction();
  return normalizeMode(resolved.mode) !== 'off';
}

/**
 * Get default redact patterns
 */
export function getDefaultRedactPatterns(): string[] {
  return [...DEFAULT_REDACT_PATTERNS];
}

// =============================================================================
// Logger Integration
// =============================================================================

/**
 * Create a redaction middleware for logger
 * 
 * Usage:
 * ```typescript
 * import { createLogger } from './logger.js';
 * import { redactForLogger } from './redact.js';
 * 
 * const log = createLogger('MyModule');
 * 
 * // Wrap sensitive log data
 * log.info('Request', redactForLogger({ apiKey: 'sk-xxx', data: 'normal' }));
 * ```
 */
export function redactForLogger<T extends Record<string, unknown>>(data: T): T {
  return redactObject(data);
}

export default {
  redactSensitiveText,
  redactObject,
  redactToolDetail,
  isRedactionEnabled,
  getDefaultRedactPatterns,
  redactForLogger,
};
