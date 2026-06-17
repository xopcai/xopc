import { input, select } from '@inquirer/prompts';

import type { OAuthCredentials, OAuthLoginCallbacks, OAuthProviderInterface } from '../../auth/index.js';
import { CredentialResolver } from '../../auth/credentials.js';
import { createLogger } from '../../utils/logger.js';

import { getOAuthProvider, type OAuthProviderConfig } from './oauth-providers.js';

const log = createLogger('OAuthLogin');

export interface RunCliOAuthLoginOptions {
  provider: string;
  onProgress?: (message: string) => void;
}

export interface RunCliOAuthLoginResult {
  provider: string;
  credentials: OAuthCredentials;
  expires?: number;
}

async function openBrowser(url: string): Promise<void> {
  const { spawn } = await import('node:child_process');
  const platform = process.platform;
  const command = platform === 'darwin' ? 'open' : platform === 'win32' ? 'cmd' : 'xdg-open';
  const args = platform === 'win32' ? ['/c', 'start', '', url] : [url];
  const child = spawn(command, args, { stdio: 'ignore', detached: true });
  child.on('error', (err) => {
    log.debug({ err, command }, 'Browser open command failed');
  });
  child.unref();
}

export function buildCliOAuthCallbacks(params: {
  config: OAuthProviderConfig;
  provider: OAuthProviderInterface;
  onProgress?: (message: string) => void;
}): OAuthLoginCallbacks {
  let manualPromptPromise: Promise<string> | undefined;
  const promptForManualCode = () =>
    (manualPromptPromise ??= input({
      message: 'Paste the authorization code (or full redirect URL):',
      validate: (value: string) => value.trim().length > 0 || 'Required',
    }));

  return {
    onAuth: (info) => {
      console.log('\n' + params.config.urlPrompt);
      console.log(info.url);
      if (info.instructions) {
        console.log('\n' + info.instructions);
      }
      if (params.provider.usesCallbackServer) {
        console.log('\nWaiting for localhost callback. If it does not complete, paste the final redirect URL below.');
      }
      void openBrowser(info.url);
      console.log('');
    },
    onDeviceCode: (info) => {
      console.log(`\nOpen ${info.verificationUri} and enter code ${info.userCode}\n`);
      void openBrowser(info.verificationUri);
    },
    onPrompt: async (prompt) =>
      input({
        message: prompt.message,
        validate: prompt.allowEmpty ? undefined : (value: string) => value.trim().length > 0 || 'Required',
      }),
    onManualCodeInput: params.provider.usesCallbackServer && params.provider.id !== 'openai-codex' ? promptForManualCode : undefined,
    onProgress: (message) => {
      params.onProgress?.(message);
    },
    onSelect: async (prompt) => {
      return select({
        message: prompt.message,
        choices: prompt.options.map((option) => ({ value: option.id, name: option.label })),
      });
    },
  };
}

export async function runCliOAuthLogin(options: RunCliOAuthLoginOptions): Promise<RunCliOAuthLoginResult> {
  const config = getOAuthProvider(options.provider);
  if (!config) {
    throw new Error(`OAuth not supported for provider: ${options.provider}`);
  }

  const credentials = await config.provider.login(
    buildCliOAuthCallbacks({ config, provider: config.provider, onProgress: options.onProgress }),
  );

  const resolver = new CredentialResolver();
  await resolver.saveOAuthToken(options.provider, {
    access: config.provider.getApiKey(credentials),
    refresh: credentials.refresh,
    expiresAt: credentials.expires,
    scope: Array.isArray(credentials.scope) ? credentials.scope.filter((value): value is string => typeof value === 'string') : undefined,
    createdAt: new Date().toISOString(),
  });

  return { provider: options.provider, credentials, expires: credentials.expires };
}
