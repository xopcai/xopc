import { Command } from 'commander';

import {
  addGatewayClientOptions,
  parseGatewayClientOptions,
} from '../../utils/gateway-client-options.js';
import { getContextWithOpts } from '../../index.js';
import { resolveConfigPath } from '../../../config/paths.js';

const METHOD_ALIASES: Record<string, { method: 'GET' | 'POST'; path: string }> = {
  health: { method: 'GET', path: '/api/health' },
  status: { method: 'GET', path: '/api/status' },
  config: { method: 'GET', path: '/api/config' },
  sessions: { method: 'GET', path: '/api/sessions' },
  models: { method: 'GET', path: '/api/models' },
  channels: { method: 'GET', path: '/api/channels/status' },
  cron: { method: 'GET', path: '/api/cron' },
  logs: { method: 'GET', path: '/api/logs' },
  agents: { method: 'GET', path: '/api/agents' },
};

export function createCallCommand(): Command {
  const cmd = new Command('call')
    .description('Call a gateway API method')
    .argument(
      '<method>',
      `Method name or API path. Built-in aliases: ${Object.keys(METHOD_ALIASES).join(', ')}`,
    )
    .option('--params <json>', 'JSON body for POST/PATCH/DELETE requests', '{}')
    .option('--http-method <method>', 'HTTP method when using a raw path', 'GET');

  addGatewayClientOptions(cmd);

  cmd.action(async (methodArg: string, options: { params?: string; httpMethod?: string }) => {
    const ctx = getContextWithOpts();
    const configPath = ctx.configPath || resolveConfigPath();
    const { callGatewayApi } = await import('../../utils/gateway-client.js');
    const clientOpts = { ...parseGatewayClientOptions(options as Record<string, unknown>), configPath };

    const alias = METHOD_ALIASES[methodArg.toLowerCase()];
    let httpMethod: 'GET' | 'POST' | 'PATCH' | 'DELETE';
    let apiPath: string;

    if (alias) {
      httpMethod = alias.method;
      apiPath = alias.path;
    } else if (methodArg.startsWith('/')) {
      httpMethod = (options.httpMethod?.toUpperCase() ?? 'GET') as 'GET' | 'POST' | 'PATCH' | 'DELETE';
      apiPath = methodArg;
    } else {
      httpMethod = (options.httpMethod?.toUpperCase() ?? 'GET') as 'GET' | 'POST' | 'PATCH' | 'DELETE';
      apiPath = `/api/${methodArg}`;
    }

    let body: unknown | undefined;
    if (httpMethod !== 'GET' && options.params && options.params !== '{}') {
      try {
        body = JSON.parse(options.params);
      } catch {
        console.error(`❌ Invalid JSON in --params: ${options.params}`);
        process.exit(1);
      }
    }

    const result = await callGatewayApi(httpMethod, apiPath, clientOpts, body);

    if (clientOpts.json || result.ok) {
      console.log(
        JSON.stringify(
          result.ok
            ? result.data
            : { error: result.error, status: result.status, durationMs: result.durationMs },
          null,
          2,
        ),
      );
    }

    if (!result.ok) {
      if (!clientOpts.json) {
        console.error(`❌ Gateway call failed: ${result.error} (status ${result.status}, ${result.durationMs}ms)`);
      }
      process.exit(1);
    }
  });

  return cmd;
}
