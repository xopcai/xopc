/**
 * Model Configuration for Onboarding
 */

import { input, select, confirm } from '@inquirer/prompts';
import type { Config } from '../../../config/schema.js';
import type { CLIContext } from '../../registry.js';
import { colors } from '../../utils/colors.js';
import {
  getModelsByProvider,
  getSortedProviders,
  getProviderDisplayName,
  providerSupportsOAuth,
  providerSupportsApiKey,
} from '../../../providers/index.js';
import { listProfilesForProvider } from '../../../auth/profiles/index.js';
import { upsertAuthProfile } from '../../../auth/profiles/index.js';
import { getOAuthProvider } from '../../utils/oauth-providers.js';
import type { OAuthLoginCallbacks } from '../../../auth/index.js';
import { CredentialResolver } from '../../../auth/credentials.js';
import { getApiKeyFromEnv } from '../../../providers/env-keys.js';

/**
 * Get available models for a provider
 */
async function getModelsForProvider(provider: string): Promise<{ value: string; name: string }[]> {
  const models = getModelsByProvider(provider);
  return models.map((m) => ({
    value: `${m.provider}/${m.id}`,
    name: m.name || m.id,
  }));
}

/**
 * Perform OAuth login for a provider
 */
async function doOAuthLogin(provider: string): Promise<boolean> {
  const config = getOAuthProvider(provider);
  if (!config) {
    console.error(`OAuth not supported for provider: ${provider}`);
    return false;
  }

  console.log(`\n🔐 Starting ${config.displayName} OAuth login...`);

  const callbacks: OAuthLoginCallbacks = {
    onAuth: (info) => {
      console.log(`\n${config.urlPrompt}`);
      console.log(info.url);
      if (info.instructions) {
        console.log('\n' + info.instructions);
      }
      console.log('\n');
    },
    onPrompt: async (prompt) => {
      return input({ message: prompt.message });
    },
    onProgress: (message) => {
      console.log(' →', message);
    },
  };

  try {
    const creds = await config.provider.login(callbacks);
    upsertAuthProfile({
      profileId: config.profileId,
      credential: {
        type: 'oauth',
        provider,
        ...creds,
      },
    });
    return true;
  } catch (error) {
    console.error('❌ OAuth login failed:', error);
    return false;
  }
}

/**
 * Configure AI model provider and model
 */
export async function setupModel(
  existingConfig: Config | null,
  ctx: CLIContext
): Promise<Config> {
  console.log('\n🤖 Step: AI Model\n');

  const config = existingConfig || ({} as Config);
  const currentModelConfig = config?.agents?.defaults?.model;
  const currentModel =
    typeof currentModelConfig === 'string' ? currentModelConfig : currentModelConfig?.primary;

  if (currentModel) {
    console.log('Current model:', currentModel);
    const keepCurrent = await confirm({
      message: 'Keep using this model?',
      default: true,
    });
    if (keepCurrent) {
      console.log('✅ Keeping:', currentModel);
      return config;
    }
  }

  // Get sorted providers with metadata
  const sortedProviders = getSortedProviders();

  const choices = sortedProviders.map((p) => ({
    value: p,
    name: getProviderDisplayName(p),
  }));

  const provider = await select({
    message: 'Select provider:',
    choices,
  });

  const providerName = getProviderDisplayName(provider);

  // Check if provider has existing profiles
  const existingProfiles = listProfilesForProvider(provider);
  if (existingProfiles.length > 0) {
    console.log(`\n${colors.green('✓')} Found existing credentials for ${providerName}`);
    const useExisting = await confirm({
      message: 'Use existing credentials?',
      default: true,
    });

    if (useExisting) {
      // Get available models
      const modelChoices = await getModelsForProvider(provider);
      if (modelChoices.length === 0) {
        console.log(`\n⚠️  No models found for ${providerName}. Please check your credentials.`);
      } else {
        const model = await select({
          message: 'Select model:',
          choices: modelChoices,
        });

        config.agents = config.agents || {};
        config.agents.defaults = config.agents.defaults || {
          workspace: ctx.workspacePath,
          model: { primary: model, fallbacks: [] },
          maxTokens: 8192,
          temperature: 0.7,
          maxToolIterations: 20,
          maxRequestsPerTurn: 50,
          maxToolFailuresPerTurn: 3,
        };
        config.agents.defaults.model = { primary: model, fallbacks: [] };
        config.agents.defaults.workspace = ctx.workspacePath;

        console.log('\n✅ Model configured:', model);
        return config;
      }
    }
  }

  let apiKey: string | undefined;
  let useOAuth = false;

  apiKey = getApiKeyFromEnv(provider);
  if (apiKey) {
    console.log(`\n${colors.green('✓')} Found API key for ${providerName} in environment`);
  }

  if (!apiKey) {
    // Check auth support from metadata
    const supportsOAuth = providerSupportsOAuth(provider);
    const supportsApiKey = providerSupportsApiKey(provider);
    const isOAuthOnly = supportsOAuth && !supportsApiKey;

    if (isOAuthOnly) {
      // OAuth only - no choice
      const success = await doOAuthLogin(provider);
      if (success) {
        useOAuth = true;
        console.log('\n✅ OAuth login successful!');
      } else {
        console.error('\n❌ OAuth login failed. This provider requires OAuth.');
        return config;
      }
    } else if (supportsOAuth && supportsApiKey) {
      // Dual auth - let user choose
      const authMethod = await select({
        message: `How would you like to authenticate with ${providerName}?`,
        choices: [
          { value: 'api_key', name: 'API Key (enter manually)' },
          { value: 'oauth', name: 'OAuth Login (browser-based)' },
        ],
      });

      if (authMethod === 'oauth') {
        const success = await doOAuthLogin(provider);
        if (success) {
          useOAuth = true;
          console.log('\n✅ OAuth login successful!');
        } else {
          console.log('\n⚠️ OAuth login failed. Please enter API key manually.');
          apiKey = await input({
            message: `API Key for ${providerName}:`,
            validate: (v: string) => v.length > 0 || 'Required',
          });
          useOAuth = false;
        }
      } else {
        apiKey = await input({
          message: `API Key for ${providerName}:`,
          validate: (v: string) => v.length > 0 || 'Required',
        });
      }
    } else {
      // API key only
      apiKey = await input({
        message: `API Key for ${providerName}:`,
        validate: (v: string) => v.length > 0 || 'Required',
      });
    }
  }

  // Get available models
  const modelChoices = await getModelsForProvider(provider);
  if (modelChoices.length === 0) {
    console.log(`\n⚠️  No built-in models found for ${providerName}.`);
    console.log('   You can still use custom model names.');
    const model = await input({
      message: 'Model name:',
      validate: (v: string) => v.length > 0 || 'Required',
    });

    // Store API key in new credential system
    if (apiKey) {
      const resolver = new CredentialResolver();
      await resolver.saveApiKey(provider, apiKey, { profileName: 'default' });
    }

    config.agents = config.agents || {};
    config.agents.defaults = config.agents.defaults || {
      workspace: ctx.workspacePath,
      model: { primary: `${provider}/${model}`, fallbacks: [] },
      maxTokens: 8192,
      temperature: 0.7,
      maxToolIterations: 20,
      maxRequestsPerTurn: 50,
      maxToolFailuresPerTurn: 3,
    };
    config.agents.defaults.model = { primary: `${provider}/${model}`, fallbacks: [] };
    config.agents.defaults.workspace = ctx.workspacePath;

    console.log('\n✅ Model configured:', `${provider}/${model}`);
    return config;
  }

  console.log(`\n📋 Available models for ${providerName}:`);
  const model = await select({
    message: 'Select model:',
    choices: modelChoices,
  });

  // Store in new credential system
  if (!useOAuth && apiKey) {
    const resolver = new CredentialResolver();
    await resolver.saveApiKey(provider, apiKey, { profileName: 'default' });
  }

  config.agents = config.agents || {};
  config.agents.defaults = config.agents.defaults || {
    workspace: ctx.workspacePath,
    model: { primary: model, fallbacks: [] },
    maxTokens: 8192,
    temperature: 0.7,
    maxToolIterations: 20,
    maxRequestsPerTurn: 50,
    maxToolFailuresPerTurn: 3,
  };
  config.agents.defaults.model = { primary: model, fallbacks: [] };
  config.agents.defaults.workspace = ctx.workspacePath;

  console.log('\n✅ Model configured:', model);
  return config;
}
