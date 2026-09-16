import { Hono } from 'hono';
import { describe, expect, it, vi } from 'vitest';

import type { GatewayService } from '../../../service.js';
import { registerCommandsSkillsRoutes } from '../commands-skills.js';

function createApp() {
  const app = new Hono();
  const getAgentSkillsApi = vi.fn(() => ({ agentId: 'main', skills: [] }));
  const getSessionSkillsApi = vi.fn(async (conversationId: string) => ({
    agentId: 'main',
    workspacePath: '/project',
    conversationId,
    skills: [{ name: 'project-skill' }],
  }));
  const getSessionWorkspaceTrustApi = vi.fn(async () => ({
    workspacePath: '/project',
    required: true,
    decision: null,
    trusted: false,
  }));
  const setSessionWorkspaceTrustApi = vi.fn(async (_conversationId: string, trusted: boolean) => ({
    workspacePath: '/project',
    required: true,
    decision: trusted,
    trusted,
  }));
  const service = {
    getConfig: () => ({ agents: { default: 'main' } }),
    marketplace: {
      getAgentSkillsApi,
      getSessionSkillsApi,
      getSessionWorkspaceTrustApi,
      setSessionWorkspaceTrustApi,
    },
  } as unknown as GatewayService;
  registerCommandsSkillsRoutes(app, { service } as Parameters<typeof registerCommandsSkillsRoutes>[1]);
  return {
    app,
    getAgentSkillsApi,
    getSessionSkillsApi,
    getSessionWorkspaceTrustApi,
    setSessionWorkspaceTrustApi,
  };
}

describe('commands and skills routes', () => {
  it('loads chat skills from the effective session workspace when conversationId is present', async () => {
    const { app, getAgentSkillsApi, getSessionSkillsApi } = createApp();
    const conversationId = 'agent:main:webchat:default:direct:project-chat';

    const response = await app.request(
      `/api/chat/skills?agentId=main&conversationId=${encodeURIComponent(conversationId)}`,
    );

    expect(response.status).toBe(200);
    expect(getSessionSkillsApi).toHaveBeenCalledWith(conversationId);
    expect(getAgentSkillsApi).not.toHaveBeenCalled();
    await expect(response.json()).resolves.toMatchObject({
      ok: true,
      payload: { workspacePath: '/project', skills: [{ name: 'project-skill' }] },
    });
  });

  it('keeps the agent workspace fallback for callers without a session', async () => {
    const { app, getAgentSkillsApi, getSessionSkillsApi } = createApp();

    const response = await app.request('/api/chat/skills?agentId=main');

    expect(response.status).toBe(200);
    expect(getAgentSkillsApi).toHaveBeenCalledWith('main');
    expect(getSessionSkillsApi).not.toHaveBeenCalled();
  });

  it('reads and persists trust only for the session workspace', async () => {
    const { app, getSessionWorkspaceTrustApi, setSessionWorkspaceTrustApi } = createApp();
    const conversationId = 'agent:main:webchat:default:direct:project-chat';

    const read = await app.request(
      `/api/chat/workspace-trust?conversationId=${encodeURIComponent(conversationId)}`,
    );
    expect(read.status).toBe(200);
    expect(getSessionWorkspaceTrustApi).toHaveBeenCalledWith(conversationId);

    const update = await app.request('/api/chat/workspace-trust', {
      method: 'PATCH',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ conversationId, trusted: true }),
    });
    expect(update.status).toBe(200);
    expect(setSessionWorkspaceTrustApi).toHaveBeenCalledWith(conversationId, true);
  });

  it('rejects malformed trust updates', async () => {
    const { app, setSessionWorkspaceTrustApi } = createApp();

    const response = await app.request('/api/chat/workspace-trust', {
      method: 'PATCH',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ trusted: true }),
    });

    expect(response.status).toBe(400);
    expect(setSessionWorkspaceTrustApi).not.toHaveBeenCalled();
  });
});
