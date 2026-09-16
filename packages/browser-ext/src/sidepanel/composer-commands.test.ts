import { afterEach, describe, expect, it, vi } from 'vitest';
const { gatewayFetch } = vi.hoisted(() => ({ gatewayFetch: vi.fn() }));
vi.mock('./auth', () => ({ gatewayFetch }));
import { findCommand, loadComposerCommands } from './composer-commands';
afterEach(() => { vi.unstubAllGlobals(); gatewayFetch.mockReset(); });

describe('composer command discovery', () => {
  it('recognizes slash commands without interpreting URLs as commands', () => {
    expect(findCommand('/sum', 4)).toEqual({ start: 0, end: 4, query: 'sum' });
    expect(findCommand('https://example.com/path', 24)).toBeUndefined();
  });
  it('resolves skills in the current session and marks unavailable skills', async () => {
    gatewayFetch.mockResolvedValueOnce(new Response(JSON.stringify({ payload: { commands: [{ name: 'new', description: 'New chat' }] } })))
      .mockResolvedValueOnce(new Response(JSON.stringify({ payload: { skills: [{ name: 'review', description: 'Review', availableForCurrentAgent: false }] } })));
    const items = await loadComposerCommands('agent:other:chat');
    expect(gatewayFetch).toHaveBeenCalledWith('/api/chat/skills?conversationId=agent%3Aother%3Achat');
    expect(items[0].wire).toBe('/new ');
    expect(items[1]).toMatchObject({ wire: '/skill:review ', disabled: true });
  });
});
