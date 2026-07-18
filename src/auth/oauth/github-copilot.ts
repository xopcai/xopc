/** GitHub Copilot OAuth adapter for pi-ai's provider-auth API. */

import { githubCopilotProvider } from '@earendil-works/pi-ai/providers/github-copilot';
import type { AuthInteraction, OAuthAuth, OAuthCredential } from '@earendil-works/pi-ai';

import type { OAuthCredentials, OAuthLoginCallbacks, OAuthProviderInterface } from './types.js';

function getCopilotOAuth(): OAuthAuth {
  const oauth = githubCopilotProvider().auth.oauth;
  if (!oauth) {
    throw new Error('GitHub Copilot OAuth is unavailable');
  }
  return oauth;
}

function toPiCredential(credentials: OAuthCredentials): OAuthCredential {
  return { ...credentials, type: 'oauth' };
}

function fromPiCredential({ type: _type, ...credentials }: OAuthCredential): OAuthCredentials {
  return credentials;
}

function toAuthInteraction(callbacks: OAuthLoginCallbacks): AuthInteraction {
  return {
    signal: callbacks.signal,
    async prompt(prompt) {
      if (prompt.type === 'select') {
        return (await callbacks.onSelect({
          message: prompt.message,
          options: [...prompt.options].map(({ id, label }) => ({ id, label })),
        })) ?? '';
      }
      return callbacks.onPrompt({
        message: prompt.message,
        placeholder: prompt.placeholder,
      });
    },
    notify(event) {
      if (event.type === 'auth_url') {
        callbacks.onAuth({ url: event.url, instructions: event.instructions });
      } else if (event.type === 'device_code') {
        callbacks.onDeviceCode({
          userCode: event.userCode,
          verificationUri: event.verificationUri,
          intervalSeconds: event.intervalSeconds,
          expiresInSeconds: event.expiresInSeconds,
        });
      } else if (event.type === 'progress' || event.type === 'info') {
        callbacks.onProgress?.(event.message);
      }
    },
  };
}

export const githubCopilotOAuthProvider: OAuthProviderInterface = {
  id: 'github-copilot',
  name: 'GitHub Copilot',
  usesCallbackServer: false,
  async login(callbacks) {
    return fromPiCredential(await getCopilotOAuth().login(toAuthInteraction(callbacks)));
  },
  async refreshToken(credentials) {
    return fromPiCredential(await getCopilotOAuth().refresh(toPiCredential(credentials)));
  },
  getApiKey(credentials) {
    return credentials.access;
  },
};
