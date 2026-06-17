import { mkdir, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { saveMediaBuffer } from '../../../media/store.js';
import {
  assertTranscriptUserMessage,
  buildTranscriptUserMessage,
  hydrateUserTurnForLlm,
  setPendingTranscriptUserMessage,
  transformUserMessageForPersistence,
} from '../attachment-pipeline.js';
import type { AgentInstanceGateway } from '../../agent-instance-gateway.js';

describe('attachment-pipeline', () => {
  let workDir = '';
  let prevStateDir: string | undefined;

  afterEach(async () => {
    if (workDir) {
      await rm(workDir, { recursive: true, force: true });
      workDir = '';
    }
    if (prevStateDir === undefined) {
      delete process.env.XOPC_STATE_DIR;
    } else {
      process.env.XOPC_STATE_DIR = prevStateDir;
    }
    vi.restoreAllMocks();
  });

  const agentManager = {
    getResolvedWorkspaceForSession: () => '/tmp/workspace',
    expandSkillUserText: (t: string) => t,
  } as unknown as AgentInstanceGateway;

  async function seedMedia(bytes: Buffer, name: string): Promise<string> {
    prevStateDir = process.env.XOPC_STATE_DIR;
    workDir = join(tmpdir(), `xopc-pipeline-${Date.now()}`);
    process.env.XOPC_STATE_DIR = workDir;
    await mkdir(workDir, { recursive: true });
    const saved = await saveMediaBuffer(bytes, {
      contentType: 'image/jpeg',
      originalFilename: name,
    });
    return saved.uri;
  }

  it('buildTranscriptUserMessage keeps text-only content without media', async () => {
    const message = await buildTranscriptUserMessage({
      text: 'Hello',
      prepared: undefined,
      sessionKey: 'agent:main:webchat:1',
      modelRef: 'openai/gpt-4o',
      config: undefined,
      agentManager,
    });

    expect(message.role).toBe('user');
    expect(message.content).toBe('Hello');
    expect(message.media).toBeUndefined();
    assertTranscriptUserMessage(message);
  });

  it('stores image metadata on media and omits inline image blocks for vision models', async () => {
    const uri = await seedMedia(Buffer.from('jpeg-bytes'), 'photo.jpg');

    const message = await buildTranscriptUserMessage({
      text: 'Check this',
      prepared: [
        {
          id: 'att-1',
          bucket: 'inbound',
          type: 'photo',
          mimeType: 'image/jpeg',
          name: 'photo.jpg',
          size: 10,
          uri,
          path: '/tmp/unused',
        },
      ],
      sessionKey: 'agent:main:webchat:1',
      modelRef: 'openai/gpt-4o',
      config: undefined,
      agentManager,
    });

    expect(message.media).toHaveLength(1);
    expect(message.media![0]!.uri).toBe(uri);
    expect(message.content).toContain('Check this');
    assertTranscriptUserMessage(message);
  });

  it('hydrateUserTurnForLlm loads image base64 for native vision models', async () => {
    const uri = await seedMedia(Buffer.from('img'), 'x.jpg');

    const turn = await hydrateUserTurnForLlm({
      message: {
        role: 'user',
        content: 'see',
        media: [
          {
            id: '1',
            bucket: 'inbound',
            type: 'image',
            mimeType: 'image/jpeg',
            name: 'x.jpg',
            size: 3,
            uri,
            path: '/tmp/x',
          },
        ],
      },
      modelRef: 'openai/gpt-4o',
    });

    expect(turn.images).toHaveLength(1);
    expect(turn.images[0]!.data).toBe(Buffer.from('img').toString('base64'));
  });

  it('hydrateUserTurnForLlm does not pass svg attachments to native vision models', async () => {
    const uri = await seedMedia(Buffer.from('<svg/>'), 'x.svg');

    const turn = await hydrateUserTurnForLlm({
      message: {
        role: 'user',
        content: 'see',
        media: [
          {
            id: '1',
            bucket: 'inbound',
            type: 'image',
            mimeType: 'image/svg+xml',
            name: 'x.svg',
            size: 6,
            uri,
            path: '/tmp/x.svg',
          },
        ],
      },
      modelRef: 'openai/gpt-4o',
    });

    expect(turn.images).toHaveLength(0);
  });

  it('buildTranscriptUserMessage keeps svg attachments as readable media refs', async () => {
    const uri = await seedMedia(Buffer.from('<svg/>'), 'icon.svg');

    const message = await buildTranscriptUserMessage({
      text: 'Check this',
      prepared: [
        {
          id: 'att-1',
          bucket: 'inbound',
          type: 'image',
          mimeType: 'image/svg+xml',
          name: 'icon.svg',
          size: 6,
          uri,
          path: '/tmp/icon.svg',
        },
      ],
      sessionKey: 'agent:main:webchat:1',
      modelRef: 'openai/gpt-4o',
      config: undefined,
      agentManager,
    });

    expect(message.media).toHaveLength(1);
    expect(message.content).toContain('xopc-media-uri:');
    expect(message.content).toContain('Use the read_media tool');
  });

  it('transformUserMessageForPersistence uses matching pending transcript row', () => {
    const pending = {
      role: 'user' as const,
      content: 'stored',
      timestamp: 1,
      media: [],
    };
    setPendingTranscriptUserMessage('sk', pending);
    const out = transformUserMessageForPersistence('sk', {
      role: 'user',
      content: [{ type: 'text', text: 'stored\n\n<context>runtime enrichment</context>' }],
    });
    expect(out).toEqual(pending);
  });

  it('transformUserMessageForPersistence does not consume stale pending rows', () => {
    const pending = {
      role: 'user' as const,
      content: 'old turn',
      timestamp: 1,
      media: [],
    };
    const runtime = {
      role: 'user' as const,
      content: [{ type: 'text' as const, text: 'new turn' }],
    };
    setPendingTranscriptUserMessage('sk-stale', pending);
    expect(transformUserMessageForPersistence('sk-stale', runtime)).toEqual(runtime);
  });
});
