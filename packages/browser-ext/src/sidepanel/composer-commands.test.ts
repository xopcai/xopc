import { afterEach, describe, expect, it, vi } from 'vitest';
const { gatewayFetch } = vi.hoisted(() => ({ gatewayFetch: vi.fn() }));
vi.mock('./auth', () => ({ gatewayFetch }));
import { findCommand, loadComposerCommands, matchesCommandQuery } from './composer-commands';
afterEach(() => { vi.unstubAllGlobals(); gatewayFetch.mockReset(); });

describe('composer command discovery', () => {
  it('recognizes slash commands without interpreting URLs as commands', () => {
    expect(findCommand('/sum', 4)).toEqual({ start: 0, end: 4, query: 'sum' });
    expect(findCommand('/会议行动', 5)).toEqual({ start: 0, end: 5, query: '会议行动' });
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
  it('searches skill names and descriptions from every locale', async () => {
    gatewayFetch.mockResolvedValueOnce(new Response(JSON.stringify({ payload: { commands: [] } })))
      .mockResolvedValueOnce(new Response(JSON.stringify({ payload: { skills: [{
        name: 'meeting-to-actions',
        description: 'Convert meeting notes into actions.',
        localizations: {
          en: { displayName: 'Meeting to Actions', description: 'Convert meeting notes into actions.' },
          'zh-CN': { displayName: '会议行动闭环', description: '从会议记录中提取行动项。' },
        },
        availableForCurrentAgent: true,
      }] } })));
    const [item] = await loadComposerCommands();
    expect(item).toBeDefined();
    expect(matchesCommandQuery(item!, 'meeting-to-actions')).toBe(true);
    expect(matchesCommandQuery(item!, 'Meeting to Actions')).toBe(true);
    expect(matchesCommandQuery(item!, '提取行动项')).toBe(true);
  });
});
