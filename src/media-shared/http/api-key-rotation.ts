/**
 * API key rotation for voice / media-understanding providers.
 *
 * Ported from openclaw/src/agents/api-key-rotation.ts (commit baseline 2026-05-08).
 *
 * DECISION (per docs/voice-rearchitecture.md §7):
 *  - Scope is voice / media-understanding only; LLM rotation is out of scope (see §7.5).
 *  - Retry decision is delegated to caller via shouldRetry callback. Default policy:
 *    rotate on 401 / 403 / 429 / "rate limit" / "quota" / "invalid api key" textual signals.
 *  - Network errors and 5xx are NOT rotated (treated as transient infra issues; let
 *    the outer fallback chain switch to a different provider instead of burning keys).
 *  - Keys are deduplicated and trimmed before iteration; empty strings are dropped.
 */

export interface ApiKeyRetryParams {
  apiKey: string;
  error: unknown;
  attempt: number;
  message: string;
}

export interface ExecuteWithApiKeyRotationOptions<T> {
  /** Provider id (used only for error messages and logs). */
  provider: string;
  /** All candidate keys; primary first. Caller usually obtains via collectProviderApiKeys. */
  apiKeys: string[];
  /** Per-key execution. Returned value is propagated when any key succeeds. */
  execute: (apiKey: string) => Promise<T>;
  /** Decide whether to rotate to the next key. Defaults to isRotatableAuthFailure. */
  shouldRetry?: (params: ApiKeyRetryParams) => boolean;
  /** Optional observation hook fired before rotating to the next key. */
  onRetry?: (params: ApiKeyRetryParams) => void;
}

const ROTATABLE_PATTERNS: RegExp[] = [
  /\b401\b/,
  /\b403\b/,
  /\b429\b/,
  /unauthorized/i,
  /forbidden/i,
  /rate[\s_-]?limit/i,
  /quota/i,
  /invalid[\s_-]?api[\s_-]?key/i,
  /api[\s_-]?key.*(invalid|expired|revoked)/i,
];

/**
 * Default retry classifier: rotate on auth / quota signals (401/403/429 + textual hints).
 * Network errors and 5xx are intentionally NOT rotated (see file-level DECISION).
 */
export function isRotatableAuthFailure(message: string): boolean {
  if (!message) {
    return false;
  }
  for (const pattern of ROTATABLE_PATTERNS) {
    if (pattern.test(message)) {
      return true;
    }
  }
  return false;
}

function dedupeApiKeys(raw: readonly string[]): string[] {
  const seen = new Set<string>();
  const keys: string[] = [];
  for (const value of raw) {
    const apiKey = value.trim();
    if (!apiKey || seen.has(apiKey)) {
      continue;
    }
    seen.add(apiKey);
    keys.push(apiKey);
  }
  return keys;
}

function formatMessage(error: unknown): string {
  if (error instanceof Error) {
    return error.message;
  }
  if (typeof error === 'string') {
    return error;
  }
  try {
    return JSON.stringify(error);
  } catch {
    return String(error);
  }
}

/**
 * Run `execute(apiKey)` with each candidate key in turn until one succeeds or all
 * keys are exhausted. The last error is rethrown when no key succeeds.
 *
 * Throws synchronously when no usable keys are configured (caller should detect
 * this via NotConfiguredError semantics in the upstream provider plugin).
 */
export async function executeWithApiKeyRotation<T>(
  options: ExecuteWithApiKeyRotationOptions<T>,
): Promise<T> {
  const keys = dedupeApiKeys(options.apiKeys);
  if (keys.length === 0) {
    throw new Error(`No API keys configured for provider "${options.provider}".`);
  }

  let lastError: unknown;
  for (let attempt = 0; attempt < keys.length; attempt += 1) {
    const apiKey = keys[attempt];
    try {
      return await options.execute(apiKey);
    } catch (error) {
      lastError = error;
      const message = formatMessage(error);
      const params: ApiKeyRetryParams = { apiKey, error, attempt, message };
      const retryable = options.shouldRetry
        ? options.shouldRetry(params)
        : isRotatableAuthFailure(message);

      if (!retryable || attempt + 1 >= keys.length) {
        break;
      }
      options.onRetry?.(params);
    }
  }

  if (lastError === undefined) {
    throw new Error(`Failed to run API request for provider "${options.provider}".`);
  }
  throw lastError;
}

/**
 * Collect candidate keys for a provider from a primary slot + an optional list of
 * extras (typically read from config under e.g. `apiKeys: string[]`).
 *
 * Empty / duplicate values are dropped. The primary key (when set) always comes
 * first so that single-key callers see no behavioral change.
 */
export function collectProviderApiKeysForExecution(input: {
  primaryApiKey?: string | null;
  extraApiKeys?: readonly string[];
}): string[] {
  const primary = input.primaryApiKey?.trim();
  const all = primary ? [primary, ...(input.extraApiKeys ?? [])] : [...(input.extraApiKeys ?? [])];
  return dedupeApiKeys(all);
}
