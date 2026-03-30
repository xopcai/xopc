/**
 * Redact secrets from log strings and structured payloads before they reach sinks.
 */

const MIN_REDACT_LENGTH = 18;
const KEEP_PREFIX_LENGTH = 6;
const KEEP_SUFFIX_LENGTH = 4;

const DEFAULT_REDACT_PATTERNS: RegExp[] = [
  /\b[A-Z0-9_]*(?:KEY|TOKEN|SECRET|PASSWORD|PASSWD)\b\s*[=:]\s*(["']?)([^\s"'\\]+)\1/gi,
  /"(?:apiKey|token|secret|password|passwd|accessToken|refreshToken|privateKey)"\s*:\s*"([^"]+)"/gi,
  /Authorization\s*[:=]\s*Bearer\s+([A-Za-z0-9._\-+=]+)/gi,
  /\b(sk-[A-Za-z0-9_-]{8,})\b/gi,
  /\b(ghp_[A-Za-z0-9]{20,})\b/gi,
  /\b(github_pat_[A-Za-z0-9_]{20,})\b/gi,
  /\b(xox[baprs]-[A-Za-z0-9-]+)\b/gi,
  /\b(\d+:[A-Za-z0-9_-]{35,})\b/g,
];

const SENSITIVE_KEYS = new Set([
  'apikey',
  'api_key',
  'token',
  'secret',
  'password',
  'passwd',
  'accesstoken',
  'refreshtoken',
  'refresh_token',
  'privatekey',
  'private_key',
  'authorization',
  'credential',
  'credentials',
]);

export function isLogRedactionEnabled(): boolean {
  return process.env.XOPCBOT_LOG_REDACTION !== 'false';
}

export function redactSecret(secret: string): string {
  if (!secret || secret.length < MIN_REDACT_LENGTH) {
    return '***';
  }
  const prefix = secret.slice(0, KEEP_PREFIX_LENGTH);
  const suffix = secret.slice(-KEEP_SUFFIX_LENGTH);
  return `${prefix}…${suffix}`;
}

export function redactPemBlock(text: string): string {
  const pemPattern =
    /(-----BEGIN\s+\w+\s+PRIVATE KEY-----)[\s\S]*?(-----END\s+\w+\s+PRIVATE KEY-----)/g;
  return text.replace(pemPattern, (_match, begin: string, end: string) => {
    return `${begin}\n[REDACTED]\n${end}`;
  });
}

export function redactSensitiveInfo(text: string): string {
  if (!text || !isLogRedactionEnabled()) return text;

  let redacted = redactPemBlock(text);

  for (const pattern of DEFAULT_REDACT_PATTERNS) {
    redacted = redacted.replace(pattern, (match, ...groups: unknown[]) => {
      const secret = groups.find(
        (g) => typeof g === 'string' && g.length >= MIN_REDACT_LENGTH,
      ) as string | undefined;
      if (secret) {
        return match.replace(secret, redactSecret(secret));
      }
      return match;
    });
  }

  return redacted;
}

export function redactObject(obj: unknown, depth = 0): unknown {
  if (!isLogRedactionEnabled() || obj === null || obj === undefined) {
    return obj;
  }
  if (depth > 12) {
    return '[MaxDepth]';
  }
  if (typeof obj === 'string') {
    return redactSensitiveInfo(obj);
  }
  if (typeof obj !== 'object') {
    return obj;
  }
  if (Array.isArray(obj)) {
    return obj.map((item) => redactObject(item, depth + 1));
  }

  const record = obj as Record<string, unknown>;
  const out: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(record)) {
    const lowerKey = key.toLowerCase();
    if (SENSITIVE_KEYS.has(lowerKey)) {
      out[key] = typeof value === 'string' ? redactSecret(value) : '***';
    } else if (typeof value === 'object' && value !== null) {
      out[key] = redactObject(value, depth + 1);
    } else if (typeof value === 'string') {
      out[key] = redactSensitiveInfo(value);
    } else {
      out[key] = value;
    }
  }
  return out;
}

/**
 * Apply redaction to a pino log object (mutates a shallow clone safe for return).
 */
export function redactLogRecord(object: Record<string, unknown>): Record<string, unknown> {
  if (!isLogRedactionEnabled()) {
    return object;
  }

  const base = redactObject(object, 0) as Record<string, unknown>;
  if (typeof base.msg === 'string') {
    base.msg = redactSensitiveInfo(base.msg);
  }
  return base;
}
