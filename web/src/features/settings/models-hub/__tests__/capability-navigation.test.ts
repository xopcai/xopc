import { describe, expect, it } from 'vitest';
import { modelCapabilityPath, withCapabilityReturnContext } from '../capability-navigation';

describe('capability return context', () => {
  it('preserves the capability, voice origin and encoded chat return through service connections', () => {
    const context = new URLSearchParams({ from: 'voice', returnTo: '/chat/test?mode=voice' });
    const destination = withCapabilityReturnContext(modelCapabilityPath('speech', true), context);
    const url = new URL(destination, 'https://example.test');
    expect(url.searchParams.get('use')).toBe('speech');
    expect(url.searchParams.get('view')).toBe('services');
    expect(url.searchParams.get('from')).toBe('voice');
    expect(url.searchParams.get('returnTo')).toBe('/chat/test?mode=voice');
  });
  it('does not forward external return paths', () => {
    expect(withCapabilityReturnContext(modelCapabilityPath('transcription'), new URLSearchParams({ returnTo: 'https://example.test' }))).toBe(modelCapabilityPath('transcription'));
  });
  it('keeps inferred voice origin when a legacy deep link has no explicit origin', () => {
    const url = new URL(withCapabilityReturnContext(modelCapabilityPath('transcription', false, 'voice'), new URLSearchParams({ returnTo: '/chat/test' })), 'https://example.test');
    expect(url.searchParams.get('from')).toBe('voice');
    expect(url.searchParams.get('returnTo')).toBe('/chat/test');
  });
});
