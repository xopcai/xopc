import { beforeEach, describe, expect, it, vi } from 'vitest';

const { apiFetch } = vi.hoisted(() => ({ apiFetch: vi.fn() }));
const { readDraft } = vi.hoisted(() => ({ readDraft: vi.fn() }));
vi.mock('@/features/chat/session/local-session-drafts', () => ({ readLocalSessionDraft: readDraft }));

vi.mock('@/lib/fetch', () => ({ apiFetch }));
vi.mock('@/lib/url', () => ({ apiUrl: (path: string) => path }));

import {
  clearSkillPaletteCaches,
  getChatSkillsCached,
  setWorkspaceTrust,
} from '@/features/chat/palette/command-palette-api';

describe('command palette API', () => {
  beforeEach(() => {
    apiFetch.mockReset();
    readDraft.mockReset().mockResolvedValue(undefined);
    clearSkillPaletteCaches();
  });

  it('scopes the skill catalog request to the active session', async () => {
    apiFetch.mockResolvedValue(new Response(JSON.stringify({
      ok: true,
      payload: {
        agentId: 'main',
        workspacePath: '/project',
        version: '1',
        loadedAt: 1,
        skills: [],
      },
    }), { status: 200 }));

    await getChatSkillsCached('main', 'agent:main:webchat:default:direct:project-chat');

    expect(apiFetch).toHaveBeenCalledWith(
      '/api/chat/skills?agentId=main&conversationId=agent%3Amain%3Awebchat%3Adefault%3Adirect%3Aproject-chat',
    );
  });

  it('persists workspace trust for the active session', async () => {
    apiFetch.mockResolvedValue(new Response(JSON.stringify({
      ok: true,
      payload: {
        workspacePath: '/project',
        required: true,
        decision: true,
        trusted: true,
      },
    }), { status: 200 }));

    await setWorkspaceTrust('agent:main:webchat:default:direct:project-chat', true);

    expect(apiFetch).toHaveBeenCalledWith('/api/chat/workspace-trust', expect.objectContaining({
      method: 'PATCH',
      body: JSON.stringify({
        conversationId: 'agent:main:webchat:default:direct:project-chat',
        trusted: true,
      }),
    }));
  });

  it('uses the selected agent catalog for a local draft and changes scope after acceptance', async () => {
    apiFetch.mockImplementation(async () => new Response(JSON.stringify({ ok: true, payload: { skills: [] } })));
    readDraft.mockResolvedValueOnce({ creation: { agentId: 'writer' } });
    await getChatSkillsCached('main', 'local-uuid');
    expect(apiFetch).toHaveBeenLastCalledWith('/api/chat/skills?agentId=writer');
    await getChatSkillsCached('writer', 'local-uuid');
    expect(apiFetch).toHaveBeenLastCalledWith('/api/chat/skills?agentId=writer&conversationId=local-uuid');
  });
});
