/**
 * Filters process environment before passing it to child processes (e.g. shell tool)
 * to avoid leaking API keys and other credentials.
 */

const BLOCKED_ENV_VAR_PATTERNS: RegExp[] = [
  /^ANTHROPIC_API_KEY$/i,
  /^OPENAI_API_KEY$/i,
  /^GEMINI_API_KEY$/i,
  /^GOOGLE_API_KEY$/i,
  /^TELEGRAM_BOT_TOKEN$/i,
  /^DISCORD_BOT_TOKEN$/i,
  /^XOPCBOT_GATEWAY_TOKEN$/i,
  /^XOPCBOT_CONFIG$/i,
  /^AWS_(SECRET_ACCESS_KEY|SECRET_KEY|SESSION_TOKEN)$/i,
  /^AZURE_(CLIENT_SECRET|KEY)$/i,
  /_?(API_KEY|TOKEN|PASSWORD|PASSWD|PRIVATE_KEY|SECRET)$/i,
];

const MAX_ENV_VAR_LENGTH = 32768;

export interface SanitizedEnvVars {
  safe: Record<string, string>;
  blocked: string[];
  warnings: string[];
}

function isDangerousEnvVar(key: string): boolean {
  const upperKey = key.toUpperCase();
  return BLOCKED_ENV_VAR_PATTERNS.some((pattern) => pattern.test(upperKey));
}

function validateEnvVarValue(key: string, value: string): string | null {
  if (value.includes('\0')) {
    return `Environment variable ${key} contains null bytes`;
  }
  if (value.length > MAX_ENV_VAR_LENGTH) {
    return `Environment variable ${key} exceeds maximum length (${MAX_ENV_VAR_LENGTH})`;
  }
  if (/^[A-Za-z0-9+/=]{80,}$/.test(value)) {
    return `Environment variable ${key} looks like base64-encoded credential data`;
  }
  return null;
}

export function sanitizeEnvVars(
  env: Record<string, string | undefined>,
  options?: {
    allowedVars?: string[];
    customBlocked?: RegExp[];
  },
): SanitizedEnvVars {
  const safe: Record<string, string> = {};
  const blocked: string[] = [];
  const warnings: string[] = [];

  const allowedVars = new Set(options?.allowedVars ?? []);
  const customBlocked = options?.customBlocked ?? [];

  for (const [key, value] of Object.entries(env)) {
    if (value === undefined) continue;

    if (allowedVars.has(key)) {
      safe[key] = value;
      continue;
    }

    const isBlocked =
      isDangerousEnvVar(key) || customBlocked.some((pattern) => pattern.test(key));

    if (isBlocked) {
      blocked.push(key);
      continue;
    }

    const warning = validateEnvVarValue(key, value);
    if (warning) {
      warnings.push(warning);
      continue;
    }

    safe[key] = value;
  }

  return { safe, blocked, warnings };
}

/**
 * Environment for agent shell execution: strips secrets, keeps normal tooling vars.
 */
export function prepareSafeToolEnv(
  baseEnv: NodeJS.ProcessEnv | Record<string, string | undefined>,
  options?: { allowedVars?: string[] },
): Record<string, string> {
  const { safe } = sanitizeEnvVars(baseEnv as Record<string, string | undefined>, options);
  return {
    ...safe,
    HOME: typeof baseEnv.HOME === 'string' && baseEnv.HOME ? baseEnv.HOME : safe.HOME || '/tmp',
  };
}
