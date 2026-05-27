/**
 * `xopc search` — manage web-search providers.
 *
 * Backed by `cfg.tools.web.search.providers[]` per `SearchProviderEntrySchema`.
 * Adds entries idempotently keyed by `type` (brave / tavily / bing / searxng).
 */

import { Command } from 'commander';

import { loadConfig } from '../../config/loader.js';
import { resolveConfigPath } from '../../config/paths.js';
import type { Config, SearchProviderEntry } from '../../config/schema.js';
import {
  applySearchTuningPatch,
  type SearchRegionMode,
} from '../../config/setup-writes/index.js';
import { register, formatExamples, type CLIContext } from '../registry.js';
import { colors } from '../utils/colors.js';

import {
  SETUP_EXIT,
  SetupValidationError,
  emitOutcome,
  isPromptCancelled,
  promptSecret,
  registerSetupDomain,
  registerSetupHandler,
  runSetup,
  runSetupHeadless,
  type SetupOutcome,
} from './setup-shared/index.js';

const SEARCH_TYPES = ['brave', 'tavily', 'bing', 'searxng'] as const;
type SearchType = (typeof SEARCH_TYPES)[number];

function isSearchType(value: string): value is SearchType {
  return (SEARCH_TYPES as readonly string[]).includes(value);
}

function readProviders(cfg: Config): SearchProviderEntry[] {
  return ((cfg.tools?.web?.search?.providers ?? []) as SearchProviderEntry[]).slice();
}

function searchEntriesEqual(a: SearchProviderEntry, b: SearchProviderEntry): boolean {
  return (
    a.type === b.type &&
    (a.apiKey ?? undefined) === (b.apiKey ?? undefined) &&
    (a.url ?? undefined) === (b.url ?? undefined) &&
    Boolean(a.disabled) === Boolean(b.disabled)
  );
}

export function applySearchProviderUpsert(
  cfg: Config,
  entry: SearchProviderEntry,
): Config {
  const list = (cfg.tools?.web?.search?.providers ?? []) as SearchProviderEntry[];
  const existing = list.find((p) => p.type === entry.type);
  // If the existing entry already matches the desired state, return the
  // config object unchanged so the diff stays empty (noop). Re-building the
  // providers array on every upsert would otherwise change object identities
  // and trigger a false-positive diff.
  if (
    existing &&
    searchEntriesEqual(existing, entry) &&
    typeof cfg.tools?.web?.search?.maxResults === 'number'
  ) {
    return cfg;
  }

  const tools = { ...((cfg.tools ?? {}) as Record<string, unknown>) };
  const web = { ...((tools.web ?? {}) as Record<string, unknown>) };
  const search = { ...((web.search ?? {}) as Record<string, unknown>) };
  const next = list.filter((p) => p.type !== entry.type);
  next.push(entry);
  search.providers = next;
  if (typeof search.maxResults !== 'number') search.maxResults = 5;
  web.search = search;
  tools.web = web;
  return { ...cfg, tools } as Config;
}

export function applySearchProviderRemove(
  cfg: Config,
  type: SearchType,
): Config {
  const list = readProviders(cfg);
  if (!list.some((p) => p.type === type)) {
    throw new SetupValidationError([
      { message: `No "${type}" search provider configured.` },
    ]);
  }
  const tools = { ...((cfg.tools ?? {}) as Record<string, unknown>) };
  const web = { ...((tools.web ?? {}) as Record<string, unknown>) };
  const search = { ...((web.search ?? {}) as Record<string, unknown>) };
  search.providers = list.filter((p) => p.type !== type);
  web.search = search;
  tools.web = web;
  return { ...cfg, tools } as Config;
}

function resolveConfigPathFromCommand(command: Command): string {
  let cur: Command | undefined = command;
  while (cur?.parent) cur = cur.parent;
  const opts = cur?.opts() as { config?: string } | undefined;
  return (
    opts?.config?.trim() ||
    process.env.XOPC_CONFIG_PATH?.trim() ||
    process.env.XOPC_CONFIG?.trim() ||
    resolveConfigPath()
  );
}

function maskKey(key?: string): string | null {
  if (!key) return null;
  if (key.length <= 8) return '*'.repeat(key.length);
  return `${key.slice(0, 4)}…${key.slice(-4)}`;
}

function summarizeEntry(entry: SearchProviderEntry): Record<string, unknown> {
  return {
    type: entry.type,
    apiKey: maskKey(entry.apiKey),
    url: entry.url,
    disabled: entry.disabled ?? false,
  };
}

function createSearchCommand(_ctx: CLIContext): Command {
  const cmd = new Command('search')
    .description('Manage web-search providers (brave / tavily / bing / searxng)')
    .addHelpText(
      'after',
      formatExamples([
        'xopc search list',
        'xopc search list --json',
        'xopc search add brave --key brv-xxx',
        'xopc search add tavily --key tvly-xxx',
        'xopc search add searxng --url http://localhost:8080',
        'xopc search remove brave',
        'xopc search add brave --key brv-xxx --dry-run --json',
        'xopc search schema --json',
      ]),
    );

  cmd
    .command('list')
    .description('List configured web-search providers')
    .option('--json', 'Output as JSON', false)
    .action((opts: { json?: boolean }, command: Command) => {
      const cfg = loadConfig(resolveConfigPathFromCommand(command));
      const providers = readProviders(cfg).map(summarizeEntry);
      if (opts.json) {
        process.stdout.write(
          JSON.stringify({ ok: true, providers, supportedTypes: [...SEARCH_TYPES] }) + '\n',
        );
        return;
      }
      console.log('');
      console.log(colors.bold('SEARCH PROVIDERS'));
      if (providers.length === 0) {
        console.log(colors.gray('  (none configured — HTML fallback only)'));
      } else {
        for (const p of providers) {
          const flag = p.disabled ? colors.gray('○ disabled') : colors.green('● active');
          const key = p.apiKey ? colors.gray(` key=${p.apiKey}`) : '';
          const url = p.url ? colors.gray(` url=${p.url}`) : '';
          console.log(`  ${String(p.type).padEnd(10)}  ${flag}${key}${url}`);
        }
      }
      console.log('');
      console.log(colors.gray(`Supported: ${SEARCH_TYPES.join(', ')}`));
    });

  cmd
    .command('add <type>')
    .description('Add or replace a search provider entry (idempotent by type)')
    .option('--key <value>', 'API key (brave / tavily / bing). Prompts securely if omitted.')
    .option('--url <value>', 'SearXNG instance URL (required for type=searxng)')
    .option('--dry-run', 'Show the change without writing', false)
    .option('--json', 'Emit a single JSON outcome line', false)
    .action(
      async (
        type: string,
        opts: { key?: string; url?: string; dryRun?: boolean; json?: boolean },
        command: Command,
      ) => {
        const dryRun = Boolean(opts.dryRun);
        const json = Boolean(opts.json);
        const t = type.trim().toLowerCase();
        if (!isSearchType(t)) {
          const outcome: SetupOutcome = {
            ok: false,
            action: 'add',
            domain: 'search',
            target: t,
            changedPaths: [],
            dryRun,
            errors: [
              {
                message: `Unknown search type "${t}". Use one of: ${SEARCH_TYPES.join(', ')}.`,
              },
            ],
          };
          emitOutcome(outcome, json);
          process.exitCode = SETUP_EXIT.ERROR;
          return;
        }

        const entry: SearchProviderEntry = { type: t };
        if (t === 'searxng') {
          if (!opts.url) {
            emitOutcome(
              {
                ok: false,
                action: 'add',
                domain: 'search',
                target: t,
                changedPaths: [],
                dryRun,
                errors: [{ path: 'url', message: '--url is required for type=searxng' }],
              },
              json,
            );
            process.exitCode = SETUP_EXIT.ERROR;
            return;
          }
          entry.url = opts.url.trim();
        } else {
          let key = opts.key?.trim();
          if (!key) {
            try {
              key = await promptSecret(`API key for ${t}:`);
            } catch (error) {
              if (isPromptCancelled(error)) {
                emitOutcome(
                  {
                    ok: false,
                    action: 'add',
                    domain: 'search',
                    target: t,
                    changedPaths: [],
                    dryRun,
                    errors: [{ message: 'Cancelled by user' }],
                  },
                  json,
                );
                process.exitCode = SETUP_EXIT.CANCELLED;
                return;
              }
              throw error;
            }
          }
          entry.apiKey = key;
        }

        await runSetup({
          configPath: resolveConfigPathFromCommand(command),
          options: { dryRun, json },
          mutator: {
            domain: 'search',
            target: t,
            action: 'add',
            mutate(cfg) {
              return applySearchProviderUpsert(cfg, entry);
            },
            resultValue: () => summarizeEntry(entry),
          },
        });
      },
    );

  cmd
    .command('remove <type>')
    .description('Remove a search provider entry')
    .option('--dry-run', 'Show the change without writing', false)
    .option('--json', 'Emit a single JSON outcome line', false)
    .action(
      async (
        type: string,
        opts: { dryRun?: boolean; json?: boolean },
        command: Command,
      ) => {
        const t = type.trim().toLowerCase();
        if (!isSearchType(t)) {
          emitOutcome(
            {
              ok: false,
              action: 'remove',
              domain: 'search',
              target: t,
              changedPaths: [],
              dryRun: Boolean(opts.dryRun),
              errors: [
                {
                  message: `Unknown search type "${t}". Use one of: ${SEARCH_TYPES.join(', ')}.`,
                },
              ],
            },
            Boolean(opts.json),
          );
          process.exitCode = SETUP_EXIT.ERROR;
          return;
        }
        await runSetup({
          configPath: resolveConfigPathFromCommand(command),
          options: { dryRun: Boolean(opts.dryRun), json: Boolean(opts.json) },
          mutator: {
            domain: 'search',
            target: t,
            action: 'remove',
            mutate(cfg) {
              return applySearchProviderRemove(cfg, t);
            },
          },
        });
      },
    );

  cmd
    .command('schema')
    .description('Print web-search setup schema for agents/UIs')
    .option('--json', 'JSON output (default human-readable JSON)', false)
    .action((opts: { json?: boolean }) => {
      const payload = {
        ok: true,
        schema: {
          target: 'cfg.tools.web.search.providers[]',
          fields: {
            type: { type: 'enum', enum: [...SEARCH_TYPES], required: true },
            key: {
              type: 'string',
              secret: true,
              description: 'API key (brave / tavily / bing).',
            },
            url: {
              type: 'url',
              description: 'SearXNG instance URL (only for type=searxng).',
            },
          },
        },
      };
      if (opts.json) process.stdout.write(JSON.stringify(payload) + '\n');
      else console.log(JSON.stringify(payload, null, 2));
    });

  return cmd;
}

register({
  id: 'search',
  name: 'search',
  description: 'Configure web-search providers',
  factory: createSearchCommand,
  metadata: {
    category: 'setup',
    examples: [
      'xopc search list',
      'xopc search add brave --key brv-xxx',
      'xopc search add searxng --url http://localhost:8080',
      'xopc search remove brave',
      'xopc search schema --json',
    ],
  },
});

// HTTP / programmatic handlers for `POST /api/setup/search/<action>`.

registerSetupHandler({
  domain: 'search',
  action: 'add',
  handler: async ({ configPath, fields, options }) => {
    const rawType = typeof fields.type === 'string' ? fields.type.trim().toLowerCase() : '';
    if (!isSearchType(rawType)) {
      return {
        ok: false,
        action: 'add',
        domain: 'search',
        target: rawType || undefined,
        changedPaths: [],
        dryRun: options.dryRun,
        errors: [{ message: `Unknown search type "${rawType}". Use one of: ${SEARCH_TYPES.join(', ')}.` }],
      };
    }
    const entry: SearchProviderEntry = { type: rawType };
    if (rawType === 'searxng') {
      const url = typeof fields.url === 'string' ? fields.url.trim() : '';
      if (!url) {
        return {
          ok: false,
          action: 'add',
          domain: 'search',
          target: rawType,
          changedPaths: [],
          dryRun: options.dryRun,
          errors: [{ path: 'url', message: 'url is required for type=searxng' }],
        };
      }
      entry.url = url;
    } else {
      const key = typeof fields.key === 'string' ? fields.key.trim() : '';
      if (!key) {
        return {
          ok: false,
          action: 'add',
          domain: 'search',
          target: rawType,
          changedPaths: [],
          dryRun: options.dryRun,
          errors: [{ path: 'key', message: 'key is required for this search type' }],
        };
      }
      entry.apiKey = key;
    }
    return runSetupHeadless({
      configPath,
      options,
      mutator: {
        domain: 'search',
        target: rawType,
        action: 'add',
        mutate: (cfg) => applySearchProviderUpsert(cfg, entry),
      },
    });
  },
});

const SEARCH_REGION_MODES = ['auto', 'cn', 'global'] as const;

function readSearchListValue(cfg: Config): Record<string, unknown> {
  const web = (cfg.tools?.web ?? {}) as Record<string, unknown>;
  const regionRaw = web.region;
  const region: SearchRegionMode =
    regionRaw === 'cn' || regionRaw === 'global' ? regionRaw : 'auto';
  const search = (web.search ?? {}) as Record<string, unknown>;
  const maxResults =
    typeof search.maxResults === 'number' && Number.isFinite(search.maxResults)
      ? Math.floor(search.maxResults)
      : 5;
  const blocklist = (web.blocklist ?? {}) as Record<string, unknown>;
  const blocklistDomains = Array.isArray(blocklist.domains)
    ? blocklist.domains.filter((d): d is string => typeof d === 'string' && d.trim().length > 0)
    : [];
  return {
    providers: readProviders(cfg).map(summarizeEntry),
    region,
    maxResults,
    blocklist: {
      enabled: blocklist.enabled === true,
      domains: blocklistDomains,
    },
  };
}

function parseSearchConfigureFields(fields: Record<string, unknown>): {
  patch: Parameters<typeof applySearchTuningPatch>[1];
  errors: Array<{ path?: string; message: string }>;
} {
  const patch: Parameters<typeof applySearchTuningPatch>[1] = {};
  const errors: Array<{ path?: string; message: string }> = [];

  if (fields.region !== undefined) {
    const region = typeof fields.region === 'string' ? fields.region.trim().toLowerCase() : '';
    if (!(SEARCH_REGION_MODES as readonly string[]).includes(region)) {
      errors.push({
        path: 'region',
        message: `region must be one of: ${SEARCH_REGION_MODES.join(', ')}`,
      });
    } else {
      patch.region = region as SearchRegionMode;
    }
  }

  if (fields.maxResults !== undefined) {
    const n =
      typeof fields.maxResults === 'number'
        ? fields.maxResults
        : Number.parseInt(String(fields.maxResults), 10);
    if (!Number.isFinite(n) || n < 1 || n > 50) {
      errors.push({ path: 'maxResults', message: 'maxResults must be an integer from 1 to 50' });
    } else {
      patch.maxResults = Math.floor(n);
    }
  }

  if (fields.blocklistEnabled !== undefined) {
    patch.blocklistEnabled = fields.blocklistEnabled === true;
  }

  if (fields.blocklistDomains !== undefined) {
    if (!Array.isArray(fields.blocklistDomains)) {
      errors.push({ path: 'blocklistDomains', message: 'blocklistDomains must be an array of strings' });
    } else {
      patch.blocklistDomains = fields.blocklistDomains
        .filter((d): d is string => typeof d === 'string')
        .map((d) => d.trim())
        .filter(Boolean);
    }
  }

  if (
    patch.region === undefined &&
    patch.maxResults === undefined &&
    patch.blocklistEnabled === undefined &&
    patch.blocklistDomains === undefined
  ) {
    errors.push({
      message:
        'At least one of region, maxResults, blocklistEnabled, or blocklistDomains is required',
    });
  }

  return { patch, errors };
}

registerSetupHandler({
  domain: 'search',
  action: 'list',
  handler: async ({ configPath }) => {
    let cfg: Config;
    try {
      cfg = loadConfig(configPath);
    } catch (error) {
      return {
        ok: false,
        action: 'noop',
        domain: 'search',
        changedPaths: [],
        dryRun: false,
        errors: [{ message: `Failed to load config: ${(error as Error).message}` }],
      };
    }
    return {
      ok: true,
      action: 'noop',
      domain: 'search',
      changedPaths: [],
      dryRun: false,
      value: readSearchListValue(cfg),
    };
  },
});

registerSetupHandler({
  domain: 'search',
  action: 'configure',
  handler: async ({ configPath, fields, options }) => {
    const { patch, errors } = parseSearchConfigureFields(fields);
    if (errors.length > 0) {
      return {
        ok: false,
        action: 'set',
        domain: 'search',
        changedPaths: [],
        dryRun: options.dryRun,
        errors,
      };
    }
    return runSetupHeadless({
      configPath,
      options,
      mutator: {
        domain: 'search',
        action: 'set',
        mutate: (cfg) => applySearchTuningPatch(cfg, patch),
        resultValue: (cfg) => readSearchListValue(cfg),
      },
    });
  },
});

registerSetupHandler({
  domain: 'search',
  action: 'remove',
  handler: async ({ configPath, fields, options }) => {
    const rawType = typeof fields.type === 'string' ? fields.type.trim().toLowerCase() : '';
    if (!isSearchType(rawType)) {
      return {
        ok: false,
        action: 'remove',
        domain: 'search',
        target: rawType || undefined,
        changedPaths: [],
        dryRun: options.dryRun,
        errors: [{ message: `Unknown search type "${rawType}". Use one of: ${SEARCH_TYPES.join(', ')}.` }],
      };
    }
    return runSetupHeadless({
      configPath,
      options,
      mutator: {
        domain: 'search',
        target: rawType,
        action: 'remove',
        mutate: (cfg) => applySearchProviderRemove(cfg, rawType),
      },
    });
  },
});

registerSetupDomain({
  domain: 'search',
  description: 'Web-search providers used by `web_search` and related tools.',
  docs: 'https://xopcai.github.io/xopc/tools',
  storage: 'cfg.tools.web.search.providers in ~/.xopc/xopc.json',
  actions: [
    {
      name: 'list',
      cli: 'xopc search list [--json]',
      description: 'List configured search providers.',
    },
    {
      name: 'add',
      cli: 'xopc search add <type> [--key <value> | --url <url>] [--dry-run] [--json]',
      description: 'Add or replace a search provider (idempotent by type).',
      fields: ['type', 'key', 'url'],
    },
    {
      name: 'remove',
      cli: 'xopc search remove <type> [--dry-run] [--json]',
      description: 'Remove a search provider entry by type.',
      fields: ['type'],
    },
    {
      name: 'configure',
      cli: 'POST /api/setup/search/configure',
      description: 'Tune region, maxResults, and domain blocklist (not provider keys).',
      fields: ['region', 'maxResults', 'blocklistEnabled', 'blocklistDomains'],
    },
    {
      name: 'schema',
      cli: 'xopc search schema [--json]',
      description: 'Print search-provider setup schema.',
    },
  ],
  fields: {
    type: {
      type: 'enum',
      description: 'Search provider type.',
      enum: [...SEARCH_TYPES],
      required: true,
    },
    key: {
      type: 'string',
      description: 'API key for brave / tavily / bing.',
      secret: true,
      source:
        'Provider dashboard (e.g. https://api.search.brave.com/, https://app.tavily.com/, etc.).',
    },
    url: {
      type: 'url',
      description: 'SearXNG instance base URL (only for type=searxng).',
    },
    region: {
      type: 'enum',
      description: 'Web region mode for search/fetch.',
      enum: [...SEARCH_REGION_MODES],
    },
    maxResults: {
      type: 'number',
      description: 'Max web_search results per query (1–50).',
    },
    blocklistEnabled: {
      type: 'boolean',
      description: 'Enable domain blocklist for web fetch/search.',
    },
    blocklistDomains: {
      type: 'string',
      description: 'Blocked domain strings (array in setup invoke fields).',
    },
  },
  targets: () => SEARCH_TYPES.map((t) => ({ id: t, name: t })),
});
