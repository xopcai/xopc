import { input } from '@inquirer/prompts';
import { Command } from 'commander';

import { CredentialResolver } from '../../auth/credentials.js';
import { loadConfig, saveConfig } from '../../config/index.js';
import { getAgentDefaultModelRef, type Config } from '../../config/schema.js';
import { prepareUpdateGlobalDefaults } from '../../gateway/global-defaults-admin.js';
import {
  getAllModels,
  getAvailableModels,
  getConfiguredProviders,
  getProviderAuthState,
  getProviderDisplayName,
  isProviderConfigured,
  providerSupportsApiKey,
  providerSupportsOAuth,
  resolveModel,
} from '../../providers/index.js';

import { getContextWithOpts } from '../context.js';
import { register, formatExamples, type CLIContext } from '../registry.js';
import { colors } from '../utils/colors.js';
import { runCliOAuthLogin } from '../utils/oauth-login.js';

const IMAGE_GENERATION_IDS = new Set([
  'gpt-image-1',
  'dall-e-3',
  'dall-e-2',
  'wan2.6-t2i',
  'wan2.7-image-pro',
  'wan2.7-image',
  'wan2.1-t2i-turbo',
  'wan2.1-t2i-plus',
  'image-01',
  'image-01-live',
]);

const VISION_IDS = new Set([
  'gpt-4o',
  'gpt-4o-mini',
  'gpt-4-turbo',
  'claude-sonnet-4-5',
  'claude-haiku-3-5',
  'gemini-2.0-flash',
  'gemini-1.5-pro',
  'qwen-vl-max',
  'qwen2.5-vl-72b-instruct',
]);

type ModelsListOptions = {
  json?: boolean;
  all?: boolean;
  provider?: string;
};

type ModelsAuthListOptions = {
  provider?: string;
  json?: boolean;
};

type ModelsAuthLoginOptions = {
  method?: 'oauth' | 'api-key';
  setDefault?: boolean;
};

function currentModelRef(config: Config): string | undefined {
  return getAgentDefaultModelRef(config);
}

function setDefaultModel(config: Config, modelRef: string): Config {
  const prep = prepareUpdateGlobalDefaults(config, {
    models: {
      defaultRole: 'deep',
      roles: {
        deep: { model: modelRef },
      },
    },
  });
  if (prep.ok === false) {
    throw new Error(prep.error);
  }
  return prep.data.nextConfig;
}

function modelRef(provider: string, id: string): string {
  return `${provider}/${id}`;
}

async function runModelsList(options: ModelsListOptions): Promise<void> {
  const ctx = getContextWithOpts();
  const config = loadConfig(ctx.configPath);
  const configuredProviders = await getConfiguredProviders();
  const providerFilter = options.provider?.trim();
  const models = (options.all ? getAllModels() : await getAvailableModels()).filter((m) =>
    providerFilter ? m.provider === providerFilter : true,
  );

  if (options.json) {
    console.log(
      JSON.stringify(
        {
          defaultModel: currentModelRef(config) ?? null,
          providers: configuredProviders,
          models: models.map((m) => ({
            id: modelRef(m.provider, m.id),
            name: m.name,
            provider: m.provider,
            authConfigured: configuredProviders.includes(m.provider),
          })),
        },
        null,
        2,
      ),
    );
    return;
  }

  console.log('\n🤖 Models\n');
  console.log('═'.repeat(60));

  console.log(`\n📌 Current default model: ${currentModelRef(config) ?? 'Not set'}\n`);

  const byProvider = new Map<string, typeof models>();
  for (const model of models) {
    const list = byProvider.get(model.provider) ?? [];
    list.push(model);
    byProvider.set(model.provider, list);
  }

  for (const [provider, providerModels] of byProvider) {
    const available = await isProviderConfigured(provider);
    console.log(`  [${provider}] ${available ? colors.green('configured') : colors.gray('not configured')}`);
    for (const model of providerModels) {
      const badges: string[] = [];
      if (IMAGE_GENERATION_IDS.has(model.id)) badges.push('gen');
      if (model.input?.includes('image') || VISION_IDS.has(model.id)) badges.push('vision');
      const badgeStr = badges.length > 0 ? ` [${badges.join(', ')}]` : '';
      console.log(`    ${available ? '✓' : '○'} ${modelRef(model.provider, model.id)}${badgeStr}`);
    }
  }

  console.log('\nUsage:');
  console.log('   xopc models set deepseek/deepseek-v4-flash');
  console.log('   xopc models auth login --provider anthropic');
  console.log('   xopc models auth paste-api-key --provider deepseek');
}

async function runModelsStatus(options: { json?: boolean }): Promise<void> {
  const ctx = getContextWithOpts();
  const config = loadConfig(ctx.configPath);
  const providers = Array.from(new Set(getAllModels().map((m) => m.provider))).sort();
  const auth = [];
  for (const provider of providers) {
    const state = await getProviderAuthState(provider);
    if (state.authMode !== 'none') {
      auth.push({ provider, ...state });
    }
  }

  if (options.json) {
    console.log(JSON.stringify({ defaultModel: currentModelRef(config) ?? null, auth }, null, 2));
    return;
  }

  console.log('\n🤖 Model status\n');
  console.log(`Default: ${currentModelRef(config) ?? 'Not set'}`);
  console.log('\nAuth:');
  if (auth.length === 0) {
    console.log('  No provider credentials configured.');
    return;
  }
  for (const entry of auth) {
    const status = entry.authStatus === 'connected' ? colors.green(entry.authStatus) : colors.yellow(entry.authStatus);
    console.log(`  ${entry.provider}: ${status} (${entry.authMode})`);
  }
}

async function runModelsSet(model: string): Promise<void> {
  const ctx = getContextWithOpts();
  const config = loadConfig(ctx.configPath);
  const resolved = resolveModel(model);
  const ref = modelRef(resolved.provider, resolved.id);
  await saveConfig(setDefaultModel(config, ref), ctx.configPath);
  console.log(`✅ Default model set: ${ref}`);
}

async function runAuthList(options: ModelsAuthListOptions): Promise<void> {
  const resolver = new CredentialResolver();
  const profiles = (await resolver.listProfiles()).filter((profile) =>
    options.provider ? profile.provider === options.provider : true,
  );
  const oauthTokens = (await resolver.listOAuthTokens()).filter((token) =>
    options.provider ? token.provider === options.provider : true,
  );

  if (options.json) {
    console.log(JSON.stringify({ profiles, oauth: oauthTokens }, null, 2));
    return;
  }

  console.log('\n🔐 Model auth\n');
  if (profiles.length === 0 && oauthTokens.length === 0) {
    console.log('  No model credentials configured.');
    return;
  }
  for (const profile of profiles) {
    console.log(`  ${profile.id}  ${colors.blue('api-key')}  ${profile.provider}  ${profile.source}`);
  }
  for (const token of oauthTokens) {
    const expires = token.expiresAt ? ` expires ${new Date(token.expiresAt).toLocaleString()}` : '';
    console.log(`  ${token.provider}:oauth  ${colors.yellow('oauth')}  ${token.hasAccess ? 'configured' : 'missing'}${expires}`);
  }
}

async function runAuthPasteApiKey(provider: string): Promise<void> {
  if (!providerSupportsApiKey(provider)) {
    throw new Error(`Provider ${provider} does not support API key auth`);
  }
  const key = await input({
    message: `API key for ${provider}:`,
    validate: (value: string) => value.trim().length > 0 || 'Required',
  });
  await new CredentialResolver().saveApiKey(provider, key.trim(), { profileName: 'default' });
  console.log(`✅ API key saved for ${provider}`);
}

function resolveAuthMethod(provider: string, rawMethod?: string): 'oauth' | 'api-key' {
  if (rawMethod && rawMethod !== 'oauth' && rawMethod !== 'api-key') {
    throw new Error(`Unsupported auth method: ${rawMethod}`);
  }
  if (rawMethod === 'oauth' || rawMethod === 'api-key') return rawMethod;
  return providerSupportsOAuth(provider) ? 'oauth' : 'api-key';
}

async function runAuthLogin(provider: string, options: ModelsAuthLoginOptions): Promise<void> {
  const method = resolveAuthMethod(provider, options.method);
  if (method === 'api-key') {
    await runAuthPasteApiKey(provider);
  } else {
    if (!providerSupportsOAuth(provider)) {
      throw new Error(`Provider ${provider} does not support OAuth`);
    }
    console.log(`\n🔐 Starting ${getProviderDisplayName(provider)} OAuth login...`);
    await runCliOAuthLogin({ provider, onProgress: (message) => console.log(' →', message) });
    console.log(`✅ OAuth login successful for ${provider}`);
  }

  if (options.setDefault) {
    const first = getAllModels().find((model) => model.provider === provider);
    if (!first) throw new Error(`No models found for provider ${provider}`);
    await runModelsSet(modelRef(first.provider, first.id));
  }
}

async function runAuthLogout(provider: string): Promise<void> {
  await new CredentialResolver().deleteProviderCredential(provider);
  console.log(`✅ Credentials removed for ${provider}`);
}

function attachModelsListOptions(command: Command): Command {
  return command
    .option('--json', 'Output as JSON', false)
    .option('--all, -a', 'Show all built-in models', false)
    .option('--provider <id>', 'Filter by provider id');
}

function createModelsCommand(_ctx: CLIContext): Command {
  const cmd = new Command('models')
    .description('List and manage models and model auth')
    .addHelpText(
      'after',
      formatExamples([
        'xopc models list',
        'xopc models status',
        'xopc models set deepseek/deepseek-v4-flash',
        'xopc models auth list',
        'xopc models auth login --provider anthropic',
        'xopc models auth paste-api-key --provider deepseek',
      ]),
    );

  attachModelsListOptions(cmd).action(async (options) => {
    await runModelsList(options);
  });

  attachModelsListOptions(cmd.command('list').description('List available models')).action(async (options) => {
    await runModelsList(options);
  });

  cmd
    .command('status')
    .description('Show default model and provider auth status')
    .option('--json', 'Output as JSON', false)
    .action(async (options: { json?: boolean }) => {
      await runModelsStatus(options);
    });

  cmd
    .command('set <model>')
    .description('Set the default model')
    .action(async (model: string) => {
      await runModelsSet(model);
    });

  const auth = cmd.command('auth').description('Manage model provider auth');

  auth
    .command('list')
    .description('List model auth credentials')
    .option('--provider <id>', 'Filter by provider id')
    .option('--json', 'Output as JSON', false)
    .action(async (options: ModelsAuthListOptions) => {
      await runAuthList(options);
    });

  auth
    .command('login')
    .description('Run provider auth flow')
    .requiredOption('--provider <id>', 'Provider id')
    .option('--method <method>', 'Auth method: oauth or api-key')
    .option('--set-default', 'Set the provider first model as default after login', false)
    .action(async (options: ModelsAuthLoginOptions & { provider: string }) => {
      await runAuthLogin(options.provider, options);
    });

  auth
    .command('paste-api-key')
    .description('Paste and save an API key')
    .requiredOption('--provider <id>', 'Provider id')
    .action(async (options: { provider: string }) => {
      await runAuthPasteApiKey(options.provider);
    });

  auth
    .command('logout')
    .description('Remove provider credentials')
    .requiredOption('--provider <id>', 'Provider id')
    .action(async (options: { provider: string }) => {
      await runAuthLogout(options.provider);
    });

  return cmd;
}

register({
  id: 'models',
  name: 'models',
  description: 'List and manage models and model auth',
  factory: createModelsCommand,
  metadata: {
    category: 'utility',
    examples: ['xopc models list', 'xopc models status', 'xopc models auth list'],
  },
});

export { createModelsCommand };
