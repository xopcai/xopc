/**
 * Lightweight option helpers for gateway CLI subcommands.
 *
 * Kept separate from `gateway-client.ts` so subcommand files can statically
 * import these (called at command construction time) without dragging in
 * `loadConfig` / `createLogger` and their transitive graph. The heavy HTTP
 * helpers in `gateway-client.ts` are dynamically imported inside actions.
 */
import type { Command } from 'commander';

export interface GatewayClientOptions {
  url?: string;
  token?: string;
  timeoutMs?: number;
  json?: boolean;
}

export function addGatewayClientOptions(cmd: Command): Command {
  return cmd
    .option('--url <url>', 'Gateway HTTP URL (defaults to config or http://127.0.0.1:18790)')
    .option('--token <token>', 'Gateway auth token')
    .option('--timeout <ms>', 'Request timeout in ms', '10000')
    .option('--json', 'Output raw JSON', false);
}

export function parseGatewayClientOptions(opts: Record<string, unknown>): GatewayClientOptions {
  const rawTimeout = opts.timeout;
  const timeoutMs =
    typeof rawTimeout === 'string'
      ? Number.parseInt(rawTimeout, 10) || 10_000
      : typeof rawTimeout === 'number' && Number.isFinite(rawTimeout)
        ? rawTimeout
        : 10_000;
  return {
    url: typeof opts.url === 'string' ? opts.url : undefined,
    token: typeof opts.token === 'string' ? opts.token : undefined,
    timeoutMs,
    json: Boolean(opts.json),
  };
}
