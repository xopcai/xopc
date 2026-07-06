import { describe, expect, it } from 'vitest';

import {
  buildGatewayRawFilePath,
  extractGeneratedImageSources,
  imageContentToSource,
  normalizeGeneratedWorkspacePath,
} from '../image-source-utils';
import type { MessageContent } from '../messages.types';

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
    expect(imageContentToSource({ type: 'image', source: { data: '/api/workspace/editor/raw?path=a.png' } }, ctx))
      .toEqual({
        uri: 'http://gateway.test/api/workspace/editor/raw?path=a.png',
        headers: { Authorization: 'Bearer token-1' },
      });
  });

  it('converts generated workspace paths to raw gateway URLs', () => {
    const source = imageContentToSource({ type: 'image', source: { data: 'media/generated/cat.png' } }, ctx);
    expect(source?.uri).toBe(
      'http://gateway.test/api/workspace/editor/raw?path=media%2Fgenerated%2Fcat.png&sessionKey=agent%3Amain%3Awebchat%3Adefault%3Adirect%3Achat_1',
    );
    expect(source?.headers).toEqual({ Authorization: 'Bearer token-1' });
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

  it('extracts generated image paths from image_generate tool results', () => {
    const content: MessageContent[] = [
      {
        type: 'tool_use',
        id: 'tool-1',
        name: 'image_generate',
        input: {},
        status: 'done',
        result: 'Generated 1 image(s).\nSaved: /tmp/workspace/media/generated/cat.png',
      },
    ];

    expect(extractGeneratedImageSources(content, ctx)).toEqual([
      {
        uri: 'http://gateway.test/api/workspace/editor/raw?path=media%2Fgenerated%2Fcat.png&sessionKey=agent%3Amain%3Awebchat%3Adefault%3Adirect%3Achat_1',
        headers: { Authorization: 'Bearer token-1' },
      },
    ]);
  });

  it('builds raw file paths with session scope', () => {
    expect(buildGatewayRawFilePath('media/generated/cat.png', 's:1'))
      .toBe('/api/workspace/editor/raw?path=media%2Fgenerated%2Fcat.png&sessionKey=s%3A1');
  });
});
