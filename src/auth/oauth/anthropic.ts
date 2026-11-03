import { anthropicProvider } from '@earendil-works/pi-ai/providers/anthropic';

import { piOAuthAdapter } from './pi-oauth-adapter.js';

export const anthropicOAuthProvider = piOAuthAdapter(
  'anthropic', 'Anthropic (Claude Pro/Max)', () => anthropicProvider().auth.oauth!,
);
