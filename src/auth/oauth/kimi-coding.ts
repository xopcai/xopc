import { piOAuthAdapter } from './pi-oauth-adapter.js';

export const kimiCodingOAuthProvider = piOAuthAdapter(
  'kimi-coding', 'Kimi For Coding (月之暗面)', async () =>
    (await import('@earendil-works/pi-ai/providers/kimi-coding')).kimiCodingProvider().auth.oauth!,
);
