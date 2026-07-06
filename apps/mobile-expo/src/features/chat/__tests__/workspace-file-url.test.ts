import { describe, expect, it } from 'vitest';

import { workspaceRelativePathToApiPath } from '../workspace-file-url';

describe('workspaceRelativePathToApiPath', () => {
  it('uses raw workspace route for inbound paths', () => {
    expect(workspaceRelativePathToApiPath('inbound/s/voice.m4a')).toBe(
      '/api/workspace/editor/raw?path=inbound%2Fs%2Fvoice.m4a',
    );
  });

  it('adds session scope to raw workspace route', () => {
    expect(workspaceRelativePathToApiPath('tts/out.mp3', { sessionKey: 'agent:main:webchat:default:direct:chat_1' })).toBe(
      '/api/workspace/editor/raw?path=tts%2Fout.mp3&sessionKey=agent%3Amain%3Awebchat%3Adefault%3Adirect%3Achat_1',
    );
  });

  it('adds agent scope when session scope is absent', () => {
    expect(workspaceRelativePathToApiPath('docs/page.html', { agentId: 'writer' })).toBe(
      '/api/workspace/editor/raw?path=docs%2Fpage.html&agentId=writer',
    );
  });
});
