import { expect, it, vi } from 'vitest';
import { withDelegationScope } from '../../orchestration/delegation-scope.js';
import { createXopcUseTool } from '../xopc-use-tool.js';

async function researchPermission(availability: string, authorize: (context: any) => Promise<any>, withContext = true) {
  const command = vi.fn(async (_command, _args, context) => ({ allowed: await context.authorizeResearch('web_search', { query: 'service official MCP' }) }));
  const tool = createXopcUseTool({
    getCurrentConversationId: () => 'conversation', getCurrentAgentId: () => 'main',
    canConfigureFromConversation: () => true, getMcpSetupService: () => ({ command }) as any,
    getAgentToolAvailability: () => ({ state: availability }) as any,
  });
  const result = await withDelegationScope({ tools: [{ name: 'web_search' }] as any,
    getToolContext: () => withContext ? { assistantMessage: { role: 'assistant', content: [] }, context: { messages: [], tools: [] } } as any : undefined,
    authorizeToolCall: authorize,
  }, () => tool.execute('setup-call', { mode: 'mcp_setup', command: 'discover', args: { serviceName: 'Service', purpose: 'Connect' } }));
  return JSON.parse(result.content[0].type === 'text' ? result.content[0].text : '{}').allowed;
}
it('does not bypass a denied web tool or invoke an alternate research backend', async () => {
  const authorize = vi.fn(async () => ({}));
  expect(await researchPermission('blocked', authorize)).toBe(false); expect(authorize).not.toHaveBeenCalled();
});
it('waits for the actual turn approval and respects its decision with real call context', async () => {
  const deny = vi.fn(async () => ({ block: true, reason: 'User denied' }));
  expect(await researchPermission('verified', deny)).toBe(false);
  expect(deny).toHaveBeenCalledWith(expect.objectContaining({ toolCall: expect.objectContaining({ name: 'web_search', arguments: { query: 'service official MCP' } }), assistantMessage: expect.any(Object), context: expect.any(Object) }), undefined);
  const allow = vi.fn(async () => ({}));
  expect(await researchPermission('verified', allow)).toBe(true);
  expect(await researchPermission('verified', allow, false)).toBe(false);
});
