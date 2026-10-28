import { expect, it, vi } from 'vitest';

const findInput = vi.hoisted(() => vi.fn());
vi.mock('../../../storage/sqlite/connection.js', () => ({ isXopcDatabaseOpen: () => true }));
vi.mock('../../../storage/sqlite/session-input-repository.js', () => ({ findSessionInputByRunId: findInput }));
import { getMcpSetupResumeInput } from '../continuation-input.js';

it('recognizes persisted host MCP continuations by provenance rather than message text', () => {
  findInput.mockReturnValue({ origin: { type: 'system', source: 'internal' }, clientMessageId: 'mcp-setup:goal', content: 'Internal instructions' });
  expect(getMcpSetupResumeInput('conversation', 'run')).toEqual({ content: 'Internal instructions' });
  expect(findInput).toHaveBeenCalledWith('conversation', 'run');
  for (const origin of [{ type: 'system', source: 'cli' }, { type: 'web' }, { type: 'channel', channel: 'weixin' }]) {
    findInput.mockReturnValue({ origin, clientMessageId: 'mcp-setup:goal', content: 'Internal instructions' });
    expect(getMcpSetupResumeInput('conversation', 'run')).toBeUndefined();
  }
  findInput.mockReturnValue({ origin: { type: 'system', source: 'internal' }, clientMessageId: 'ordinary-input', content: 'MCP configuration is saved.' });
  expect(getMcpSetupResumeInput('conversation', 'run')).toBeUndefined();
  findInput.mockReturnValue(undefined);
  expect(getMcpSetupResumeInput('conversation', 'run')).toBeUndefined();
});
