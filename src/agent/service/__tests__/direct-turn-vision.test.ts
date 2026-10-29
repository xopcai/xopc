import { createHash, randomUUID } from 'node:crypto';

import sharp from 'sharp';
import { expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({ run: vi.fn(async (_params: unknown) => ({ ok: true })) }));
vi.mock('../../embedded/run-for-session.js', () => ({ runEmbeddedTurnForSession: mocks.run }));
vi.mock('../../../storage/sqlite/connection-wait-repository.js', () => ({ getConnectionResumeInput: () => undefined }));
vi.mock('../../../storage/sqlite/clarification-wait-repository.js', () => ({ getClarificationResumeInput: () => undefined }));
vi.mock('../../../tasks/task-context-assembler.js', () => ({ buildTaskExecutionDirective: () => '', buildDelegatedTaskDirective: () => '' }));
vi.mock('../../image/vision-detection.js', () => ({ resolveImageHandlingStrategy: () => 'native' }));

import { runDirectAgentTurn, type RunDirectAgentTurnDeps } from '../direct-turn-helpers.js';
import { hydrateUserTurnForLlm } from '../../inbound/attachment-pipeline.js';
import { persistInboundAttachments } from '../../../channels/attachments/inbound-persist.js';

it('matches serial image hydration across interleaved red and blue turns with the same file name', async () => {
  const fixtures = await Promise.all(['#ff0000', '#0000ff'].map(async (color, index) => {
    const buffer = await sharp({ create: { width: 64, height: 64, channels: 3, background: color } }).png().toBuffer();
    const media = await persistInboundAttachments([{ type: 'image', mimeType: 'image/png', name: 'fixture.png',
      data: buffer.toString('base64') }]);
    return { index, hash: createHash('sha256').update(buffer).digest('hex'), message: {
      role: 'user' as const, content: 'Describe the image.', timestamp: Date.now(), media,
    } };
  }));
  for (let round = 0; round < 4; round++) {
    await Promise.all(fixtures.map(async fixture => {
      const conversationId = randomUUID();
      const context = { dynamicSystemContext: `Context ${fixture.index}` };
      const deps = {
        agentManager: { prepareUserTurnContext: async () => {
          await new Promise(resolve => setTimeout(resolve, fixture.index === round % 2 ? 10 : 0));
          return context;
        }, scheduleBackgroundReviewAfterUserTurn: vi.fn() },
        modelManager: { getModelForSession: () => 'fixture/model' }, sessionStore: {},
      } as unknown as RunDirectAgentTurnDeps;
      await deps.agentManager.prepareUserTurnContext(fixture.message, conversationId, 'serial');
      const serial = await hydrateUserTurnForLlm({ message: fixture.message, modelRef: 'fixture/model' });
      await runDirectAgentTurn(deps, { conversationId, runId: randomUUID(), userMessage: fixture.message });
      const actual = mocks.run.mock.calls.map(([params]) => params as { conversationId: string; llmImages: Array<{ data: string }> })
        .find(params => params.conversationId === conversationId)!;
      expect(actual.llmImages).toEqual(serial.images);
      expect(actual.llmImages).toHaveLength(1);
      const decoded = Buffer.from(actual.llmImages[0]!.data, 'base64');
      expect(createHash('sha256').update(decoded).digest('hex')).toBe(fixture.hash);
      expect((await sharp(decoded).stats()).channels.map(channel => channel.mean))
        .toEqual(fixture.index === 0 ? [255, 0, 0] : [0, 0, 255]);
    }));
  }
});
