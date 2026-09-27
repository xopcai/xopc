import { expect, it, vi } from 'vitest';
const create = vi.hoisted(() => vi.fn().mockResolvedValue('draft'));
vi.mock('../../../query/sessions', () => ({ createSession: create }));
import { openNewChat } from '../open-new-chat';

it('opens a new local draft on each explicit new-chat request', async () => {
  await openNewChat({ agentId: 'main', projectId: null });
  await openNewChat({ agentId: 'main', projectId: null });
  expect(create).toHaveBeenCalledTimes(2);
  expect(create).toHaveBeenLastCalledWith({ agentId: 'main', projectId: undefined, executionMode: undefined, initialAgentConfig: undefined });
});
