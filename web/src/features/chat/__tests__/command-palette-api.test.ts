import { beforeEach, describe, expect, it, vi } from 'vitest';

const { apiFetch } = vi.hoisted(() => ({ apiFetch: vi.fn() }));

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
      '/api/chat/skills?agentId=main&sessionKey=agent%3Amain%3Awebchat%3Adefault%3Adirect%3Aproject-chat',
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
        sessionKey: 'agent:main:webchat:default:direct:project-chat',
        trusted: true,
      }),
    }));
  });
});
