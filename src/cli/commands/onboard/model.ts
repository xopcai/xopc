/**
 * Catalog-driven model configuration for onboarding.
 */

import { confirm, input, select } from '@inquirer/prompts';

import { CredentialResolver } from '../../../auth/credentials.js';
import { listProfilesForProvider } from '../../../auth/profiles/index.js';
import {
  getModelsJsonPath,
  loadModelsJson,
  saveModelsJson,
  type ModelsJsonConfig,
} from '../../../config/models-json.js';
import type { Config } from '../../../config/schema.js';
import { getAgentDefaultModelRef } from '../../../config/schema.js';
import { prepareUpdateGlobalDefaults } from '../../../gateway/global-defaults-admin.js';
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
  getDomesticProviderBaseUrl,
  getDomesticProviderPreset,
  getDomesticProviderPresetIds,
  providerConfigFromDomesticPreset,
  type DomesticProviderPreset,
} from '../../../providers/domestic-presets.js';
import {
  discoverProviderModels,
  isProviderApiDiscoverable,
  type DiscoveredProviderModel,
} from '../../../providers/model-discovery.js';
import {
  getProviderHint,
  getRecommendedModelsForProvider,
  sortModelsForPicker,
  sortProvidersForPicker,
} from '../../../providers/presentation.js';
import {
  getXopcCloudCatalogCoordinator,
  type XopcCloudCatalogCoordinator,
} from '../../../providers/xopc-cloud-catalog-coordinator.js';
import { getOAuthProvider } from '../../utils/oauth-providers.js';
import { runCliOAuthLogin } from '../../utils/oauth-login.js';
import type { CLIContext } from '../../registry.js';
import { colors } from '../../utils/colors.js';

type ModelChoice = { value: string; name: string; description?: string };
type CustomApiKind = 'openai-completions' | 'openai-responses' | 'anthropic-messages';

export function setPrimaryModel(
  config: Config,
  workspacePath: string,
  modelRef: string,
): Config {
  const id = config.agents.default ?? config.agents.list[0]?.id ?? 'main';
  const index = config.agents.list.findIndex((entry) => entry.id === id);
  let nextConfig = config;
  if (index >= 0) {
    const agent = config.agents.list[index]!;
    const nextList = [...config.agents.list];
    nextList[index] = {
      ...agent,
      workspace: { root: workspacePath },
    };
    nextConfig = { ...config, agents: { ...config.agents, list: nextList } };
  }
  const presetId = nextConfig.agents.defaultPreset ?? 'default';
  const currentModels = nextConfig.agents.capabilityPresets[presetId]?.models;
  const prep = prepareUpdateGlobalDefaults(nextConfig, {
    models: {
      ...currentModels,
      defaultRole: 'deep',
      roles: { ...currentModels?.roles, deep: { model: modelRef } },
    },
  });
  if (prep.ok === false) {
    throw new Error(prep.error);
  }
  return prep.data.nextConfig;
}

function formatRecommended(provider: string): string | undefined {
  const labels = getRecommendedModelsForProvider(provider, 3).map((m) => m.name || m.id);
  return labels.length > 0 ? `Recommended: ${labels.join(', ')}` : getProviderHint(provider);
}

function providerChoices(): Array<{ value: string; name: string; description?: string }> {
  const providers = sortProvidersForPicker([...new Set([...getAllProviders(), ...getDomesticProviderPresetIds()])]);
  const choices = providers.map((provider) => ({
    value: provider,
    name: getDomesticProviderPreset(provider)?.displayName ?? getProviderDisplayName(provider),
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
  const catalogModels = sortModelsForPicker(getModelsByProvider(provider)).map((m) => {
    const badges = [m.reasoning ? 'reasoning' : '', m.input?.includes('image') ? 'vision' : '']
      .filter(Boolean)
      .join(', ');
    return {
      value: `${m.provider}/${m.id}`,
      name: m.name || m.id,
      description: badges || undefined,
    };
  });
  if (catalogModels.length > 0) return catalogModels;

  const preset = getDomesticProviderPreset(provider);
  if (!preset) return [];
  return preset.models.map((m) => {
    const badges = [m.reasoning ? 'reasoning' : '', m.input?.includes('image') ? 'vision' : '']
      .filter(Boolean)
      .join(', ');
    return {
      value: `${preset.id}/${m.id}`,
      name: m.name || m.id,
      description: badges || undefined,
    };
  });
}

export async function refreshOnboardModelCatalogIfNeeded(
  provider: string,
  hasCatalogModels: boolean,
  coordinator: Pick<XopcCloudCatalogCoordinator, 'refresh'> = getXopcCloudCatalogCoordinator(),
): Promise<void> {
  if (provider !== 'xopc-cloud' || hasCatalogModels) return;

  console.log('\n→ Loading models from XOPC Model Service...');
  const result = await coordinator.refresh('oauth');
  if (result.state === 'not-authorized') {
    throw new Error('XOPC Model Service credentials are unavailable after OAuth login. Please sign in again.');
  }
  if (result.error || result.modelCount === 0) {
    throw new Error(result.error?.message ?? 'XOPC Model Service did not publish any models for this account.');
  }
  console.log(colors.green(`✓ Loaded ${result.modelCount} models`));
}

function discoveredModelsToChoices(provider: string, models: DiscoveredProviderModel[]): ModelChoice[] {
  return models
    .filter((model) => !model.id.includes('/'))
    .map((model) => ({
      value: `${provider}/${model.id}`,
      name: model.name || model.id,
      description: 'discovered',
    }));
}

async function discoverModelsForOnboard(params: {
  providerId: string;
  baseUrl: string;
  apiKey: string;
  api: CustomApiKind;
  headers?: Record<string, string>;
}): Promise<ModelChoice[]> {
  if (!isProviderApiDiscoverable(params.api)) return [];
  try {
    console.log('\n→ Discovering models from /models...');
    const models = await discoverProviderModels({
      providerId: params.providerId,
      baseUrl: params.baseUrl,
      apiKey: params.apiKey,
      api: params.api,
      headers: params.headers,
    });
    const choices = discoveredModelsToChoices(params.providerId, models);
    if (choices.length > 0) {
      console.log(colors.green(`✓ Discovered ${choices.length} models`));
      return choices;
    }
  } catch (error) {
    console.log(colors.gray(`Model discovery unavailable: ${error instanceof Error ? error.message : String(error)}`));
  }
  return [];
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

  const discoveredChoices = await discoverModelsForOnboard({
    providerId: defaultProviderIdFromBaseUrl(baseUrl),
    baseUrl,
    apiKey,
    api,
  });
  const modelRef =
    discoveredChoices.length > 0
      ? await select({
          message: 'Model:',
          choices: discoveredChoices.map((choice) => ({ ...choice, name: modelChoiceName(choice) })),
        })
      : (await input({
          message: 'Model ID:',
          validate: (value) => value.trim().length > 0 || 'Required',
        })).trim();
  const modelId = modelRef.includes('/') ? modelRef.split('/').slice(1).join('/') : modelRef;

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
        models: (discoveredChoices.length > 0 ? discoveredChoices : [{ value: `${providerId}/${modelId}`, name: modelId }]).map(
          (choice) => {
            const id = choice.value.split('/').slice(1).join('/');
            return { id, name: choice.name, api, contextWindow: 128000, input: ['text'] };
          },
        ),
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

function resolvePresetEnvCredential(preset: DomesticProviderPreset): { envVar: string; value: string } | undefined {
  for (const envVar of preset.envVars) {
    const value = process.env[envVar]?.trim();
    if (value) return { envVar, value };
  }
  return undefined;
}

async function setupDomesticPreset(
  config: Config,
  ctx: CLIContext,
  preset: DomesticProviderPreset,
): Promise<Config> {
  console.log(`\n${preset.onboardingIcon ?? '🇨🇳'} ${preset.displayName}\n`);
  console.log(preset.description);
  if (preset.quirks?.length) {
    for (const quirk of preset.quirks) {
      console.log(colors.gray(`Note: ${quirk}`));
    }
  }

  const baseUrlChoice = await select({
    message: 'Endpoint:',
    choices: [
      ...preset.baseUrlPresets.map((entry) => ({
        value: entry.baseUrl,
        name: entry.label,
        description: entry.description ?? entry.baseUrl,
      })),
      { value: 'custom', name: 'Custom URL' },
    ],
    default: getDomesticProviderBaseUrl(preset),
  });
  const baseUrl =
    baseUrlChoice === 'custom'
      ? (await input({
          message: 'API base URL:',
          default: getDomesticProviderBaseUrl(preset),
          validate: (value) => URL.canParse(value) || 'Enter a valid URL',
        })).trim()
      : baseUrlChoice;

  const envCredential = resolvePresetEnvCredential(preset);
  if (envCredential) {
    console.log(`\n${colors.green('✓')} Found ${envCredential.envVar} in environment`);
  }
  const apiKeyConfig = envCredential
    ? envCredential.envVar
    : (await input({
        message: `API key for ${preset.displayName}:`,
        validate: (value) => value.trim().length > 0 || 'Required',
      })).trim();
  const probeApiKey = envCredential?.value ?? apiKeyConfig;

  const discoveredChoices = await discoverModelsForOnboard({
    providerId: preset.id,
    baseUrl,
    apiKey: probeApiKey,
    api: preset.api as CustomApiKind,
    headers: preset.headers,
  });
  const modelChoices = discoveredChoices.length > 0 ? discoveredChoices : getModelsForProvider(preset.id);
  if (preset.requiresModelDiscovery && modelChoices.length === 0) {
    throw new Error(
      `No models are available from ${preset.displayName}. Ask an administrator to publish a model, then retry.`,
    );
  }
  const modelRef = await select({
    message: 'Model:',
    choices: modelChoices.map((choice) => ({ ...choice, name: modelChoiceName(choice) })),
    default: preset.defaultModel ? `${preset.id}/${preset.defaultModel}` : modelChoices[0]?.value,
  });
  const modelId = modelRef.split('/').slice(1).join('/');

  const shouldProbe = await confirm({
    message: 'Probe endpoint now?',
    default: !modelId.includes('your-endpoint-id'),
  });
  if (shouldProbe) {
    try {
      console.log('\n→ Probing endpoint...');
      await probeCustomProvider({ baseUrl, apiKey: probeApiKey, modelId, api: preset.api as CustomApiKind });
      console.log(colors.green('✓ Probe succeeded'));
    } catch (error) {
      console.error(error instanceof Error ? error.message : String(error));
      const continueAnyway = await confirm({ message: 'Save this provider anyway?', default: false });
      if (!continueAnyway) return config;
    }
  }

  const path = getModelsJsonPath();
  const { config: modelsConfig } = loadModelsJson(path);
  const nextModelsConfig: ModelsJsonConfig = {
    providers: {
      ...(modelsConfig.providers ?? {}),
      [preset.id]: providerConfigFromDomesticPreset(preset, {
        baseUrl,
        apiKey: apiKeyConfig,
        modelIds: modelChoices.map((choice) => choice.value.split('/').slice(1).join('/')),
      }),
    },
  };
  const saved = saveModelsJson(path, nextModelsConfig);
  if (!saved.success) {
    throw new Error(saved.error || 'Failed to save models.json');
  }
  getModelRegistry().refresh();

  console.log('\n✅ Provider configured:', preset.displayName);
  console.log('✅ Model configured:', modelRef);
  return setPrimaryModel(config, ctx.workspacePath, modelRef);
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
  const currentModel = getAgentDefaultModelRef(config);

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

  const domesticPreset = getDomesticProviderPreset(provider);
  if (domesticPreset) {
    return await setupDomesticPreset(config, ctx, domesticPreset);
  }

  const providerName = getProviderDisplayName(provider);
  const credentialOk = await ensureProviderCredential(provider, providerName);
  if (!credentialOk) {
    console.error(`\n❌ Could not configure credentials for ${providerName}.`);
    return config;
  }

  let modelChoices = getModelsForProvider(provider);
  await refreshOnboardModelCatalogIfNeeded(provider, modelChoices.length > 0);
  modelChoices = getModelsForProvider(provider);
  if (modelChoices.length === 0) {
    if (provider === 'xopc-cloud') {
      throw new Error(`No models are currently available for ${providerName}.`);
    }
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
