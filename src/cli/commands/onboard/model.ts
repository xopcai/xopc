/**
 * Catalog-driven model configuration for onboarding.
 */

import { confirm, input, select } from '@inquirer/prompts';

import { CredentialResolver } from '../../../auth/credentials.js';
import {
  getModelsJsonPath,
  loadModelsJson,
  saveModelsJson,
  type ModelsJsonConfig,
} from '../../../config/models-json.js';
import type { Config } from '../../../config/schema.js';
import {
  getAllProviders,
  getApiKeyFromEnv,
  getModelRegistry,
  getModelsByProvider,
  getProviderDisplayName,
  providerSupportsApiKey,
  providerSupportsOAuth,
} from '../../../providers/index.js';
import {
  getProviderHint,
  getRecommendedModelsForProvider,
  sortModelsForPicker,
  sortProvidersForPicker,
} from '../../../providers/presentation.js';
import { listProfilesForProvider } from '../../../auth/profiles/index.js';
import { getOAuthProvider } from '../../utils/oauth-providers.js';
import { runCliOAuthLogin } from '../../utils/oauth-login.js';
import type { CLIContext } from '../../registry.js';
import { colors } from '../../utils/colors.js';

type ModelChoice = { value: string; name: string; description?: string };
type CustomApiKind = 'openai-completions' | 'openai-responses' | 'anthropic-messages';

function ensureAgentDefaults(config: Config, workspacePath: string): NonNullable<Config['agents']>['defaults'] {
  config.agents = config.agents || {};
  config.agents.defaults = config.agents.defaults || {
    workspace: workspacePath,
    maxTokens: 8192,
    temperature: 0.7,
    maxToolIterations: 20,
    maxRequestsPerTurn: 50,
    maxToolFailuresPerTurn: 3,
  };
  config.agents.defaults.workspace = workspacePath;
  return config.agents.defaults;
}

function setPrimaryModel(config: Config, workspacePath: string, modelRef: string): Config {
  const defaults = ensureAgentDefaults(config, workspacePath);
  defaults.models = { ...defaults.models, chat: { primary: modelRef, fallbacks: [] } };
  return config;
}

function formatRecommended(provider: string): string | undefined {
  const labels = getRecommendedModelsForProvider(provider, 3).map((m) => m.name || m.id);
  return labels.length > 0 ? `Recommended: ${labels.join(', ')}` : getProviderHint(provider);
}

function providerChoices(): Array<{ value: string; name: string; description?: string }> {
  const providers = sortProvidersForPicker(getAllProviders());
  const choices = providers.map((provider) => ({
    value: provider,
    name: getProviderDisplayName(provider),
    description: formatRecommended(provider),
  }));
  choices.push({
    value: 'custom-api',
    name: 'Custom API',
    description: 'OpenAI-compatible, OpenAI Responses, or Anthropic-compatible endpoint',
  });
  return choices;
}

function modelChoiceName(choice: ModelChoice): string {
  return choice.description ? `${choice.name}  ${colors.gray(choice.description)}` : choice.name;
}

function getModelsForProvider(provider: string): ModelChoice[] {
  return sortModelsForPicker(getModelsByProvider(provider)).map((m) => {
    const badges = [m.reasoning ? 'reasoning' : '', m.input?.includes('image') ? 'vision' : '']
      .filter(Boolean)
      .join(', ');
    return {
      value: `${m.provider}/${m.id}`,
      name: m.name || m.id,
      description: badges || undefined,
    };
  });
}

async function doOAuthLogin(provider: string): Promise<boolean> {
  const config = getOAuthProvider(provider);
  if (!config) {
    console.error(`OAuth not supported for provider: ${provider}`);
    return false;
  }

  console.log(`\n🔐 Starting ${config.displayName} OAuth login...`);
  try {
    await runCliOAuthLogin({ provider, onProgress: (message) => console.log(' →', message) });
    return true;
  } catch (error) {
    console.error('❌ OAuth login failed:', error);
    return false;
  }
}

function joinEndpoint(baseUrl: string, suffix: string): string {
  return `${baseUrl.replace(/\/+$/, '')}/${suffix.replace(/^\/+/, '')}`;
}

async function probeCustomProvider(params: {
  baseUrl: string;
  apiKey: string;
  modelId: string;
  api: CustomApiKind;
}): Promise<void> {
  const timeout = AbortSignal.timeout(30_000);
  const commonHeaders = {
    'content-type': 'application/json',
    authorization: `Bearer ${params.apiKey}`,
  };

  const request =
    params.api === 'anthropic-messages'
      ? {
          url: joinEndpoint(params.baseUrl, '/messages'),
          headers: { ...commonHeaders, 'anthropic-version': '2023-06-01' },
          body: { model: params.modelId, max_tokens: 1, messages: [{ role: 'user', content: 'ping' }] },
        }
      : params.api === 'openai-responses'
        ? {
            url: joinEndpoint(params.baseUrl, '/responses'),
            headers: commonHeaders,
            body: { model: params.modelId, input: 'ping', max_output_tokens: 1 },
          }
        : {
            url: joinEndpoint(params.baseUrl, '/chat/completions'),
            headers: commonHeaders,
            body: { model: params.modelId, messages: [{ role: 'user', content: 'ping' }], max_tokens: 1 },
          };

  const res = await fetch(request.url, {
    method: 'POST',
    headers: request.headers,
    body: JSON.stringify(request.body),
    signal: timeout,
  });
  if (!res.ok) {
    const text = await res.text().catch(() => '');
    throw new Error(`Probe failed (${res.status}) at ${request.url}${text ? `: ${text.slice(0, 300)}` : ''}`);
  }
}

function defaultProviderIdFromBaseUrl(baseUrl: string): string {
  try {
    const url = new URL(baseUrl);
    return url.hostname
      .replace(/^api\./, '')
      .split('.')
      .filter(Boolean)
      .slice(0, 2)
      .join('-')
      .toLowerCase()
      .replace(/[^a-z0-9-_]+/g, '-')
      .replace(/^-+|-+$/g, '') || 'custom';
  } catch {
    return 'custom';
  }
}

function validateProviderId(value: string): true | string {
  return /^[a-z0-9]([a-z0-9-_]*[a-z0-9])?$/.test(value)
    ? true
    : 'Use lowercase letters, numbers, hyphens, or underscores; start/end with a letter or number.';
}

async function setupCustomApi(config: Config, ctx: CLIContext): Promise<Config> {
  console.log('\n🔌 Custom API provider\n');

  const baseUrl = (await input({
    message: 'API base URL:',
    default: 'https://api.example.com/v1',
    validate: (value) => URL.canParse(value) || 'Enter a valid URL',
  })).trim();

  const apiKey = (await input({
    message: 'API key:',
    validate: (value) => value.trim().length > 0 || 'Required',
  })).trim();

  const api = await select<CustomApiKind>({
    message: 'Compatibility:',
    choices: [
      { value: 'openai-completions', name: 'OpenAI-compatible Chat Completions' },
      { value: 'openai-responses', name: 'OpenAI Responses' },
      { value: 'anthropic-messages', name: 'Anthropic Messages' },
    ],
  });

  const modelId = (await input({
    message: 'Model ID:',
    validate: (value) => value.trim().length > 0 || 'Required',
  })).trim();

  console.log('\n→ Probing endpoint...');
  await probeCustomProvider({ baseUrl, apiKey, modelId, api });
  console.log(colors.green('✓ Probe succeeded'));

  const existingProviders = new Set(getAllProviders());
  const providerId = (await input({
    message: 'Provider ID:',
    default: defaultProviderIdFromBaseUrl(baseUrl),
    validate: (value) => {
      const valid = validateProviderId(value.trim());
      if (valid !== true) return valid;
      if (existingProviders.has(value.trim())) return 'Provider ID already exists; choose a new ID.';
      return true;
    },
  })).trim();

  const path = getModelsJsonPath();
  const { config: modelsConfig } = loadModelsJson(path);
  const nextModelsConfig: ModelsJsonConfig = {
    providers: {
      ...(modelsConfig.providers ?? {}),
      [providerId]: {
        baseUrl,
        apiKey,
        api,
        models: [{ id: modelId, name: modelId, api, contextWindow: 128000, input: ['text'] }],
      },
    },
  };
  const saved = saveModelsJson(path, nextModelsConfig);
  if (!saved.success) {
    throw new Error(saved.error || 'Failed to save models.json');
  }
  getModelRegistry().refresh();

  const ref = `${providerId}/${modelId}`;
  console.log('\n✅ Custom model configured:', ref);
  return setPrimaryModel(config, ctx.workspacePath, ref);
}

async function ensureProviderCredential(provider: string, providerName: string): Promise<boolean> {
  const existingProfiles = listProfilesForProvider(provider);
  if (existingProfiles.length > 0) {
    console.log(`\n${colors.green('✓')} Found existing credentials for ${providerName}`);
    return await confirm({ message: 'Use existing credentials?', default: true });
  }

  const envKey = getApiKeyFromEnv(provider);
  if (envKey) {
    console.log(`\n${colors.green('✓')} Found API key for ${providerName} in environment`);
    return true;
  }

  const supportsOAuth = providerSupportsOAuth(provider);
  const supportsApiKey = providerSupportsApiKey(provider);

  if (supportsOAuth && !supportsApiKey) {
    return await doOAuthLogin(provider);
  }

  let useOAuth = false;
  if (supportsOAuth && supportsApiKey) {
    const authMethod = await select<'api_key' | 'oauth'>({
      message: `How would you like to authenticate with ${providerName}?`,
      choices: [
        { value: 'api_key', name: 'API key' },
        { value: 'oauth', name: 'OAuth login' },
      ],
    });
    useOAuth = authMethod === 'oauth';
  }

  if (useOAuth) {
    const ok = await doOAuthLogin(provider);
    if (ok) return true;
    console.log('\n⚠️ OAuth login failed. Enter an API key instead.');
  }

  if (!supportsApiKey) return false;
  const apiKey = await input({
    message: `API key for ${providerName}:`,
    validate: (value) => value.trim().length > 0 || 'Required',
  });
  const resolver = new CredentialResolver();
  await resolver.saveApiKey(provider, apiKey.trim(), { profileName: 'default' });
  return true;
}

export async function setupModel(existingConfig: Config | null, ctx: CLIContext): Promise<Config> {
  console.log('\n🤖 Step: AI Model\n');

  const config = existingConfig || ({} as Config);
  const currentModel = config?.agents?.defaults?.models?.chat?.primary;

  if (currentModel) {
    console.log('Current model:', currentModel);
    const keepCurrent = await confirm({ message: 'Keep using this model?', default: true });
    if (keepCurrent) {
      console.log('✅ Keeping:', currentModel);
      return config;
    }
  }

  const provider = await select({
    message: 'Model/auth provider:',
    choices: providerChoices(),
  });

  if (provider === 'custom-api') {
    return await setupCustomApi(config, ctx);
  }

  const providerName = getProviderDisplayName(provider);
  const credentialOk = await ensureProviderCredential(provider, providerName);
  if (!credentialOk) {
    console.error(`\n❌ Could not configure credentials for ${providerName}.`);
    return config;
  }

  const modelChoices = getModelsForProvider(provider);
  if (modelChoices.length === 0) {
    throw new Error(`No catalog models found for ${providerName}. Add a Custom API provider instead.`);
  }

  console.log(`\n📋 Models for ${providerName}:`);
  const model = await select({
    message: 'Model:',
    choices: modelChoices.map((choice) => ({ ...choice, name: modelChoiceName(choice) })),
  });

  console.log('\n✅ Model configured:', model);
  return setPrimaryModel(config, ctx.workspacePath, model);
}
