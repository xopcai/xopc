import { describe, expect, it } from 'vitest';

import { isGatewayThemePageUrl } from './theme';

describe('isGatewayThemePageUrl', () => {
  it('accepts local Gateway development and production ports', () => {
    expect(isGatewayThemePageUrl('http://localhost:3000/#/settings/appearance')).toBe(true);
    expect(isGatewayThemePageUrl('http://127.0.0.1:18790/#/chat')).toBe(true);
  });

  it('accepts only the paired remote Gateway origin', () => {
    expect(isGatewayThemePageUrl('https://gateway.example.test/chat', 'https://gateway.example.test')).toBe(true);
    expect(isGatewayThemePageUrl('https://other.example.test/chat', 'https://gateway.example.test')).toBe(false);
  });

  it('rejects invalid and browser-internal URLs', () => {
    expect(isGatewayThemePageUrl('not-a-url')).toBe(false);
    expect(isGatewayThemePageUrl('chrome://extensions')).toBe(false);
  });
});
