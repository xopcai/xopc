import type { OAuthAuth, OAuthCredential, ProviderAuthInteraction } from '@earendil-works/pi-ai';

import { registerBundledOAuthFlows } from '../../providers/register-bundled-oauth-flows.js';
import type { OAuthCredentials, OAuthLoginCallbacks, OAuthProviderInterface } from './types.js';

function fromPiCredential({ type: _type, ...credential }: OAuthCredential): OAuthCredentials {
  return credential;
}

/** Translate xopc login callbacks and credentials to pi's provider-auth API. */
export function piOAuthAdapter(id: string, name: string, getOAuth: () => Promise<OAuthAuth>): OAuthProviderInterface {
  return {
    id,
    name,
    async login(callbacks: OAuthLoginCallbacks) {
      await registerBundledOAuthFlows();
      const oauth = await getOAuth();
      const interaction: ProviderAuthInteraction = {
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
      return fromPiCredential(await oauth.login(interaction));
    },
    async refreshToken(credentials, signal) {
      await registerBundledOAuthFlows();
      const oauth = await getOAuth();
      return fromPiCredential(await oauth.refresh(
        { ...credentials, type: 'oauth' }, signal ?? new AbortController().signal,
      ));
    },
    getApiKey: credentials => credentials.access,
  };
}
