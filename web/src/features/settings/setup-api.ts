/**
 * Web client for the gateway setup API (`POST /api/setup/<domain>/<action>`).
 *
 * The endpoint is the HTTP equivalent of the M1 `xopc <domain> <action>`
 * CLI. Both share `runSetupHeadless` on the server, so the request/response
 * contract here matches `SetupOutcome` exactly — agents (M2 skills), forms
 * (M3 panels) and CLI users all see the same JSON shape.
 *
 * For the cross-domain manifest, see `GET /api/setup/manifest`.
 */

import { fetchJson } from '@/lib/fetch';
import { apiUrl } from '@/lib/url';

export type SetupAction = 'add' | 'set' | 'remove' | 'noop';

export interface SetupError {
  path?: string;
  message: string;
}

export interface SetupOutcome<TValue = unknown> {
  ok: boolean;
  action: SetupAction;
  domain: string;
  target?: string;
  changedPaths: string[];
  dryRun: boolean;
  errors?: SetupError[];
  value?: TValue;
  notes?: string[];
}

export interface CallSetupArgs {
  domain: string;
  action: string;
  fields?: Record<string, unknown>;
  dryRun?: boolean;
}

/** Thrown when the gateway returns a non-`ok` outcome. Carries the structured
 *  `errors[]` so callers can surface field-specific messages. */
export class SetupApiError extends Error {
  readonly outcome: SetupOutcome;

  constructor(outcome: SetupOutcome) {
    const summary = outcome.errors?.length
      ? outcome.errors.map((e) => (e.path ? `[${e.path}] ${e.message}` : e.message)).join('; ')
      : `Setup ${outcome.domain}/${outcome.action} failed`;
    super(summary);
    this.name = 'SetupApiError';
    this.outcome = outcome;
  }
}

/**
 * Invoke a setup action on the gateway. Returns the {@link SetupOutcome} on
 * success and throws {@link SetupApiError} on `ok: false` (so callers using
 * `try/catch` can render the structured `errors[]`). The endpoint is
 * authenticated via the gateway token through the standard fetch wrapper.
 */
export async function callSetup<TValue = unknown>(
  args: CallSetupArgs,
): Promise<SetupOutcome<TValue>> {
  const path = `/api/setup/${encodeURIComponent(args.domain)}/${encodeURIComponent(args.action)}`;
  const outcome = await fetchJson<SetupOutcome<TValue>>(apiUrl(path), {
    method: 'POST',
    body: JSON.stringify({
      fields: args.fields ?? {},
      dryRun: Boolean(args.dryRun),
    }),
  });
  if (!outcome.ok) {
    throw new SetupApiError(outcome);
  }
  return outcome;
}

/** Fetch the gateway's setup manifest — same shape as `xopc setup manifest`. */
export async function fetchSetupManifest(): Promise<{
  ok: boolean;
  version: 1;
  domains: Array<{
    domain: string;
    description: string;
    docs?: string;
    storage?: string;
    actions: Array<{ name: string; cli: string; description: string; fields?: readonly string[] }>;
    fields: Record<string, unknown>;
    targets?: Array<{ id: string; name: string; meta?: Record<string, unknown> }>;
  }>;
}> {
  return fetchJson(apiUrl('/api/setup/manifest'));
}
