import { randomUUID } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';

import type { OAuthAuth, OAuthCredential, ProviderAuthInteraction } from '@earendil-works/pi-ai';

import { resolveCredentialsDir } from '../../config/paths.js';
import { writeTextAtomic } from '../../infra/write-file-atomic.js';
import { withOAuthProviderLock } from '../oauth-provider-lock.js';
import { registerBundledOAuthFlows } from '../../providers/register-bundled-oauth-flows.js';
import type { OAuthCredentials, OAuthLoginCallbacks, OAuthProviderInterface } from './types.js';

async function getDeviceId(signal?: AbortSignal): Promise<string> {
  return withOAuthProviderLock('openai-device-id', async () => {
    const path = join(resolveCredentialsDir(), 'openai-device-id');
    try {
      const id = (await readFile(path, 'utf8')).trim();
      if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(id)) {
        throw new Error('Invalid OpenAI installation device ID');
      }
      return id;
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
      const id = randomUUID();
      await writeTextAtomic(path, id);
      return id;
    }
  }, { signal });
}

async function getOpenaiOAuth(): Promise<OAuthAuth> {
  const { openaiProvider } = await import('@earendil-works/pi-ai/providers/openai');
  await registerBundledOAuthFlows();
  const oauth = openaiProvider().auth.oauth;
  if (!oauth) throw new Error('OpenAI ChatGPT OAuth is unavailable');
  return oauth;
}

function fromPiCredential({ type: _type, ...credentials }: OAuthCredential): OAuthCredentials {
  return credentials;
}

function toAuthInteraction(callbacks: OAuthLoginCallbacks): ProviderAuthInteraction {
  return {
    signal: callbacks.signal ?? new AbortController().signal,
    async prompt(prompt) {
      if (prompt.type === 'select') {
        return await callbacks.onSelect({ message: prompt.message, options: [...prompt.options] }) ?? '';
      }
      return callbacks.onPrompt({ message: prompt.message, placeholder: prompt.placeholder, signal: prompt.signal });
    },
    notify(event) {
      if (event.type === 'auth_url') callbacks.onAuth({ url: event.url, instructions: event.instructions });
      else if (event.type === 'device_code') callbacks.onDeviceCode(event);
      else callbacks.onProgress?.(event.message);
    },
  };
}

export const openaiOAuthProvider: OAuthProviderInterface = {
  id: 'openai',
  name: 'OpenAI (ChatGPT subscription)',
  usesCallbackServer: true,
  loginMethods: ['browser'],
  async login(callbacks) {
    const deviceId = await getDeviceId(callbacks.signal);
    const oauth = await getOpenaiOAuth();
    return fromPiCredential(await oauth.login(toAuthInteraction(callbacks), {
      getDeviceId: () => deviceId,
      agentName: 'xopc',
    }));
  },
  async refreshToken(credentials, signal) {
    const oauth = await getOpenaiOAuth();
    return fromPiCredential(await oauth.refresh(
      { ...credentials, type: 'oauth' }, signal ?? new AbortController().signal,
    ));
  },
  getApiKey(credentials) {
    return credentials.access;
  },
};
