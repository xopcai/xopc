import { describe, expect, it } from 'vitest';

import { imageContentToSource, normalizeGeneratedWorkspacePath } from '../image-source-utils';

const ctx = {
  apiUrl: (path: string) => `http://gateway.test${path}`,
  token: 'token-1',
  sessionKey: 'agent:main:webchat:default:direct:chat_1',
};

describe('image-source-utils', () => {
  it('keeps data URLs unchanged', () => {
    expect(imageContentToSource({ type: 'image', source: { data: 'data:image/png;base64,abc' } }, ctx))
      .toEqual({ uri: 'data:image/png;base64,abc' });
  });

  it('converts gateway relative image URLs to absolute URLs with auth headers', () => {
    expect(imageContentToSource({ type: 'image', source: { data: '/api/files/file-id/content' } }, ctx))
      .toEqual({
        uri: 'http://gateway.test/api/files/file-id/content',
        headers: { Authorization: 'Bearer token-1' },
      });
  });

  it('does not reinterpret unmanaged workspace paths', () => {
    expect(imageContentToSource({ type: 'image', source: { data: 'media/generated/cat.png' } }, ctx)).toBeNull();
  });

  it('converts media URI images to gateway media read URLs', () => {
    const source = imageContentToSource({ type: 'image', source: { data: 'media://generated/chat/cat.png' } }, ctx);
    expect(source?.uri).toBe(
      'http://gateway.test/api/media/read?uri=media%3A%2F%2Fgenerated%2Fchat%2Fcat.png&sessionKey=agent%3Amain%3Awebchat%3Adefault%3Adirect%3Achat_1',
    );
    expect(source?.headers).toEqual({ Authorization: 'Bearer token-1' });
  });

  it('normalizes absolute generated file paths to workspace-relative paths', () => {
    expect(normalizeGeneratedWorkspacePath('/Users/me/.xopc/workspace/media/generated/cat.png'))
      .toBe('media/generated/cat.png');
  });

});
