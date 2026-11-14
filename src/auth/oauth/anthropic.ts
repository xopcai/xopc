import { piOAuthAdapter } from './pi-oauth-adapter.js';

export const anthropicOAuthProvider = piOAuthAdapter(
  'anthropic', 'Anthropic (Claude Pro/Max)', async () =>
    (await import('@earendil-works/pi-ai/providers/anthropic')).anthropicProvider().auth.oauth!,
);
