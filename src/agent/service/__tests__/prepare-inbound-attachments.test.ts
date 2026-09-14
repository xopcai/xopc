import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, describe, expect, it, vi } from 'vitest';

import { AgentService } from '../../service.js';
import { MAX_WEBCHAT_ATTACHMENT_FILE_BYTES } from '../../../gateway/chat-limits.js';

describe('chat attachment persistence limits', () => {
  let stateDir: string | undefined;
  afterEach(async () => {
    vi.unstubAllEnvs();
    if (stateDir) await rm(stateDir, { recursive: true, force: true });
  });

  it('persists files above the media store default and enforces the chat limit', async () => {
    stateDir = await mkdtemp(join(tmpdir(), 'xopc-chat-attachments-'));
    vi.stubEnv('XOPC_STATE_DIR', stateDir);
    const service = Object.create(AgentService.prototype) as AgentService;
    const bytes = Buffer.alloc(6 * 1024 * 1024, 65);
    const result = await service.prepareInboundAttachments('webchat:test', [{
      type: 'document', name: 'large.csv', mimeType: 'text/csv', data: bytes.toString('base64'),
    }]);
    expect(result).toHaveLength(1);
    expect((await readFile(result![0]!.path)).equals(bytes)).toBe(true);

    await expect(service.prepareInboundAttachments('webchat:test', [{
      type: 'document', name: 'too-large.bin', mimeType: 'application/octet-stream',
      data: Buffer.alloc(MAX_WEBCHAT_ATTACHMENT_FILE_BYTES + 1).toString('base64'),
    }])).rejects.toThrow();
  });
});
