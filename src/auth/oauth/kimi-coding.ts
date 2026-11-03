import { kimiCodingProvider } from '@earendil-works/pi-ai/providers/kimi-coding';

import { piOAuthAdapter } from './pi-oauth-adapter.js';

export const kimiCodingOAuthProvider = piOAuthAdapter(
  'kimi-coding', 'Kimi For Coding (月之暗面)', () => kimiCodingProvider().auth.oauth!,
);
