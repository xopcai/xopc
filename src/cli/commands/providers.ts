/**
 * `xopc providers` — user-friendly hub for managing LLM provider credentials.
 *
 * This command sits on top of the existing auth-profile store (`xopc auth …`),
 * but presents a setup-style surface — `list / set-key / unset-key / schema` —
 * with the same `SetupOutcome` JSON contract used by other M1 setup commands.
 * Agents (M2 skills) and the WebUI (M3) can consume both shapes uniformly.
 *
 * Capability-provider (image / voice) settings live under `cfg.providers.<id>`
 * and will be wired into this command's flags in a follow-up slice.
 */

import { Command } from 'commander';

import {
  type AuthProfileCredential,
  getProfile,
  listAllProfiles,
  listProfilesForProvider,
  removeAuthProfile,
  upsertAuthProfile,
} from '../../auth/profiles/index.js';
import {
  PROVIDER_ENV_MAP,
  PROVIDER_META,
  getAllProviders,
  getApiKeyFromEnv,
  getSortedProviders,
  type ProviderMeta,
} from '../../providers/index.js';

import { register, formatExamples, type CLIContext } from '../registry.js';
import { colors } from '../utils/colors.js';

import {
  SETUP_EXIT,
  emitOutcome,
  isPromptCancelled,
  promptSecret,
  registerSetupDomain,
  type SetupOutcome,
} from './setup-shared/index.js';

type KeyStatus =
  | 'configured'         // auth profile present
  | 'env-only'           // no profile, but env var detected
  | 'oauth'              // OAuth-only provider
  | 'not-configured';

interface ProviderListEntry {
  id: string;
  name: string;
  category: ProviderMeta['category'];
  supportsApiKey: boolean;
  supportsOAuth: boolean;
  status: KeyStatus;
  profileCount: number;
  envVar?: string;
}

const KEY_OPTION_HINT =
  'You can either pass --key=<value>, set the env var (e.g. OPENAI_API_KEY), or omit --key to be prompted securely.';

function defaultProfileId(provider: string): string {
  return `${provider}:default`;
}

function maskKey(value: string | undefined): string | null {
  if (!value) return null;
  if (value.length <= 8) return '*'.repeat(value.length);
  return `${value.slice(0, 4)}…${value.slice(-4)}`;
}

function computeKeyStatus(id: string, meta: ProviderMeta, profileCount: number): KeyStatus {
  if (profileCount > 0) return 'configured';
  if (getApiKeyFromEnv(id)) return 'env-only';
  if (meta.supportsOAuth && !meta.supportsApiKey) return 'oauth';
  return 'not-configured';
}

function providerEnvVar(id: string): string {
  return PROVIDER_ENV_MAP[id]?.[0] ?? `${id.toUpperCase().replace(/-/g, '_')}_API_KEY`;
}

function listProviders(): ProviderListEntry[] {
  const ids = getSortedProviders().length > 0 ? getSortedProviders() : getAllProviders();
  return ids.map((id) => {
    const meta = PROVIDER_META[id] ?? { name: id, category: 'specialty', supportsApiKey: true };
    const profileCount = listProfilesForProvider(id).length;
    return {
      id,
      name: meta.name,
      category: meta.category,
      supportsApiKey: Boolean(meta.supportsApiKey),
      supportsOAuth: Boolean(meta.supportsOAuth),
      status: computeKeyStatus(id, meta, profileCount),
      profileCount,
      envVar: providerEnvVar(id),
    };
  });
}

const STATUS_BADGE: Record<KeyStatus, string> = {
  configured: colors.green('● configured'),
  'env-only': colors.cyan('● env-only'),
  oauth: colors.gray('● oauth'),
  'not-configured': colors.gray('○ not set'),
};

function printListText(entries: ProviderListEntry[]): void {
  const grouped = new Map<ProviderMeta['category'], ProviderListEntry[]>();
  for (const e of entries) {
    const bucket = grouped.get(e.category) ?? [];
    bucket.push(e);
    grouped.set(e.category, bucket);
  }
  const order: ProviderMeta['category'][] = ['common', 'specialty', 'oauth', 'enterprise', 'extension'];
  for (const cat of order) {
    const list = grouped.get(cat);
    if (!list?.length) continue;
    console.log('');
    console.log(colors.bold(cat.toUpperCase()));
    const idWidth = Math.max(...list.map((e) => e.id.length));
    for (const e of list) {
      const id = e.id.padEnd(idWidth);
      const note = e.profileCount > 1 ? colors.gray(` (${e.profileCount} profiles)`) : '';
      console.log(`  ${id}  ${STATUS_BADGE[e.status]}  ${colors.gray(e.name)}${note}`);
    }
  }
  console.log('');
  console.log(colors.gray('Use: xopc providers set-key <id> --key <key>'));
}

function printListJson(entries: ProviderListEntry[]): void {
  process.stdout.write(JSON.stringify({ ok: true, providers: entries }) + '\n');
}

interface MutationOptions {
  dryRun: boolean;
  json: boolean;
}

function planSetKey(args: {
  provider: string;
  profileId: string;
  key: string;
}): { existing?: AuthProfileCredential; next: AuthProfileCredential; willChange: boolean } {
  const existing = getProfile(args.profileId);
  const next: AuthProfileCredential = {
    type: 'api_key',
    provider: args.provider,
    key: args.key,
  };
  const willChange =
    !existing ||
    existing.type !== 'api_key' ||
    existing.key !== args.key ||
    existing.provider !== args.provider;
  return { existing, next, willChange };
}

async function runSetKey(args: {
  provider: string;
  profileId: string;
  key: string;
  options: MutationOptions;
}): Promise<SetupOutcome> {
  const meta = PROVIDER_META[args.provider];
  if (meta && meta.supportsApiKey === false) {
    const outcome: SetupOutcome = {
      ok: false,
      action: 'add',
      domain: 'providers',
      target: args.provider,
      changedPaths: [],
      dryRun: args.options.dryRun,
      errors: [
        {
          message: `Provider "${args.provider}" does not support API keys; use OAuth via \`xopc auth login ${args.provider}\`.`,
        },
      ],
    };
    emitOutcome(outcome, args.options.json);
    process.exitCode = SETUP_EXIT.ERROR;
    return outcome;
  }

  const { existing, willChange } = planSetKey(args);
  const changedPaths = willChange ? [`profiles.${args.profileId}.key`] : [];
  const action = existing ? 'set' : 'add';

  if (!willChange) {
    const outcome: SetupOutcome = {
      ok: true,
      action: 'noop',
      domain: 'providers',
      target: args.provider,
      changedPaths: [],
      dryRun: args.options.dryRun,
      value: { profileId: args.profileId, key: maskKey(args.key) },
      notes: ['Key is unchanged.'],
    };
    emitOutcome(outcome, args.options.json);
    process.exitCode = SETUP_EXIT.OK;
    return outcome;
  }

  if (!args.options.dryRun) {
    try {
      upsertAuthProfile({
        profileId: args.profileId,
        credential: { type: 'api_key', provider: args.provider, key: args.key },
      });
    } catch (error) {
      const outcome: SetupOutcome = {
        ok: false,
        action,
        domain: 'providers',
        target: args.provider,
        changedPaths,
        dryRun: false,
        errors: [{ message: (error as Error).message }],
      };
      emitOutcome(outcome, args.options.json);
      process.exitCode = SETUP_EXIT.ERROR;
      return outcome;
    }
  }

  const outcome: SetupOutcome = {
    ok: true,
    action,
    domain: 'providers',
    target: args.provider,
    changedPaths,
    dryRun: args.options.dryRun,
    value: { profileId: args.profileId, key: maskKey(args.key) },
  };
  emitOutcome(outcome, args.options.json);
  process.exitCode = SETUP_EXIT.OK;
  return outcome;
}

async function runUnsetKey(args: {
  provider: string;
  profileId: string;
  options: MutationOptions;
}): Promise<SetupOutcome> {
  const existing = getProfile(args.profileId);
  if (!existing) {
    const outcome: SetupOutcome = {
      ok: true,
      action: 'noop',
      domain: 'providers',
      target: args.provider,
      changedPaths: [],
      dryRun: args.options.dryRun,
      notes: [`No profile "${args.profileId}" to remove.`],
    };
    emitOutcome(outcome, args.options.json);
    process.exitCode = SETUP_EXIT.OK;
    return outcome;
  }

  const changedPaths = [`profiles.${args.profileId}`];
  if (!args.options.dryRun) {
    removeAuthProfile(args.profileId);
  }

  const outcome: SetupOutcome = {
    ok: true,
    action: 'remove',
    domain: 'providers',
    target: args.provider,
    changedPaths,
    dryRun: args.options.dryRun,
    value: { profileId: args.profileId, removed: true },
  };
  emitOutcome(outcome, args.options.json);
  process.exitCode = SETUP_EXIT.OK;
  return outcome;
}

function emitSchema(opts: { providerId?: string; json: boolean }): void {
  const payload = {
    ok: true,
    schema: {
      target: 'auth profile (~/.xopc/auth.json)',
      action: { type: 'string', enum: ['set-key', 'unset-key', 'list', 'schema'] },
      fields: {
        provider: {
          type: 'string',
          description: 'Provider id (e.g. openai, anthropic, deepseek). See `xopc providers list`.',
          enum: getAllProviders(),
        },
        key: {
          type: 'string',
          secret: true,
          description: 'API key. Prefer passing via stdin/prompt over CLI arg to avoid shell history leaks.',
        },
        profile: {
          type: 'string',
          default: '<provider>:default',
          description: 'Optional profile id when managing multiple keys per provider.',
        },
      },
      outcome: {
        ok: 'boolean',
        action: 'add | set | remove | noop',
        domain: 'providers',
        target: '<provider>',
        changedPaths: 'string[]',
        dryRun: 'boolean',
        value: '{ profileId, key? }',
      },
    },
    providers: opts.providerId
      ? listProviders().filter((p) => p.id === opts.providerId)
      : listProviders(),
  };
  if (opts.json) {
    process.stdout.write(JSON.stringify(payload) + '\n');
  } else {
    console.log(JSON.stringify(payload, null, 2));
  }
}

function createProvidersCommand(_ctx: CLIContext): Command {
  const cmd = new Command('providers')
    .description('Manage LLM provider credentials (user-friendly hub over `xopc auth`)')
    .addHelpText(
      'after',
      formatExamples([
        'xopc providers list',
        'xopc providers list --json',
        'xopc providers set-key openai --key sk-xxx',
        'xopc providers set-key deepseek            # prompts for the key (no echo)',
        'xopc providers set-key anthropic --key sk-ant-... --profile work',
        'xopc providers unset-key openai',
        'xopc providers set-key openai --key sk-xxx --dry-run --json',
        'xopc providers schema --json',
      ]),
    );

  cmd
    .command('list')
    .description('List known providers and credential status')
    .option('--json', 'Output as JSON for agents/UI', false)
    .action((opts: { json?: boolean }) => {
      const entries = listProviders();
      if (opts.json) {
        printListJson(entries);
      } else {
        printListText(entries);
      }
    });

  cmd
    .command('set-key <provider>')
    .description('Set or update the API key for a provider (writes an auth profile)')
    .option('--key <value>', `API key value. ${KEY_OPTION_HINT}`)
    .option('--profile <id>', 'Profile id (default: <provider>:default)')
    .option('--dry-run', 'Show the change without writing', false)
    .option('--json', 'Emit a single JSON outcome line', false)
    .action(
      async (
        provider: string,
        opts: { key?: string; profile?: string; dryRun?: boolean; json?: boolean },
      ) => {
        const profileId = opts.profile?.trim() || defaultProfileId(provider);
        let key = opts.key?.trim();
        if (!key) {
          try {
            key = await promptSecret(`API key for ${provider}:`);
          } catch (error) {
            if (isPromptCancelled(error)) {
              const outcome: SetupOutcome = {
                ok: false,
                action: 'set',
                domain: 'providers',
                target: provider,
                changedPaths: [],
                dryRun: Boolean(opts.dryRun),
                errors: [{ message: 'Cancelled by user' }],
              };
              emitOutcome(outcome, Boolean(opts.json));
              process.exitCode = SETUP_EXIT.CANCELLED;
              return;
            }
            throw error;
          }
        }
        await runSetKey({
          provider,
          profileId,
          key,
          options: { dryRun: Boolean(opts.dryRun), json: Boolean(opts.json) },
        });
      },
    );

  cmd
    .command('unset-key <provider>')
    .description('Remove a provider auth profile')
    .option('--profile <id>', 'Profile id (default: <provider>:default)')
    .option('--dry-run', 'Show the change without writing', false)
    .option('--json', 'Emit a single JSON outcome line', false)
    .action(
      async (
        provider: string,
        opts: { profile?: string; dryRun?: boolean; json?: boolean },
      ) => {
        const profileId = opts.profile?.trim() || defaultProfileId(provider);
        await runUnsetKey({
          provider,
          profileId,
          options: { dryRun: Boolean(opts.dryRun), json: Boolean(opts.json) },
        });
      },
    );

  cmd
    .command('schema [provider]')
    .description('Print a JSON description of provider setup fields (for agents / UIs)')
    .option('--json', 'JSON output (default human-readable JSON)', false)
    .action((providerId: string | undefined, opts: { json?: boolean }) => {
      emitSchema({ providerId, json: Boolean(opts.json) });
    });

  return cmd;
}

// Internal exports for tests.
export { listProviders, planSetKey, maskKey, runSetKey, runUnsetKey };
// Avoid "unused import" lint noise; listAllProfiles is exported for diagnostics.
export { listAllProfiles };

register({
  id: 'providers',
  name: 'providers',
  description: 'Manage LLM provider credentials',
  factory: createProvidersCommand,
  metadata: {
    category: 'setup',
    examples: [
      'xopc providers list',
      'xopc providers set-key openai --key sk-xxx',
      'xopc providers unset-key openai',
      'xopc providers schema --json',
    ],
  },
});

registerSetupDomain({
  domain: 'providers',
  description: 'Manage LLM provider credentials (API keys, OAuth profiles).',
  docs: 'https://xopcai.github.io/xopc/models',
  storage: '~/.xopc/auth-profiles.json (auth profile store)',
  actions: [
    {
      name: 'list',
      cli: 'xopc providers list [--json]',
      description: 'List known providers with credential status (configured / env-only / oauth / not-set).',
    },
    {
      name: 'set-key',
      cli: 'xopc providers set-key <provider> [--key <value>] [--profile <id>] [--dry-run] [--json]',
      description: 'Set or update the API key for a provider. Prompts securely if --key is omitted.',
      fields: ['provider', 'key', 'profile'],
    },
    {
      name: 'unset-key',
      cli: 'xopc providers unset-key <provider> [--profile <id>] [--dry-run] [--json]',
      description: 'Remove a provider auth profile.',
      fields: ['provider', 'profile'],
    },
    {
      name: 'schema',
      cli: 'xopc providers schema [provider] [--json]',
      description: 'Print a structured description of provider setup fields.',
    },
  ],
  fields: {
    provider: {
      type: 'enum',
      description: 'Provider id. See `xopc providers list` for the full set.',
      required: true,
      enum: getAllProviders(),
    },
    key: {
      type: 'string',
      description: 'API key value. Prefer interactive prompt over CLI arg to avoid shell-history leaks.',
      secret: true,
      source: 'Provider dashboard (e.g. https://platform.openai.com/api-keys for OpenAI).',
    },
    profile: {
      type: 'string',
      description: 'Optional profile id when managing multiple keys per provider.',
      default: '<provider>:default',
    },
  },
  targets: () =>
    listProviders().map((entry) => ({
      id: entry.id,
      name: entry.name,
      meta: {
        category: entry.category,
        supportsApiKey: entry.supportsApiKey,
        supportsOAuth: entry.supportsOAuth,
        status: entry.status,
        envVar: entry.envVar,
      },
    })),
});
