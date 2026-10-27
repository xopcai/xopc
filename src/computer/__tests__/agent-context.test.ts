import { afterEach, describe, expect, it } from 'vitest';
import { bindComputerAgentTurn, clearComputerFrames, computerAgentTurn, computerImagesForRequest,
  computerRequestFrameCleanup, endComputerAgentTurn, retainComputerFrame } from '../agent-context.js';

const model = { id: 'visual', provider: 'custom', baseUrl: 'https://model.test/v1', input: ['image'] } as any;
afterEach(async () => { await endComputerAgentTurn('one', 'run'); clearComputerFrames('one'); await endComputerAgentTurn('buffer-owner', 'buffer-run'); });
describe('ephemeral main-model UI observation', () => {
  it('copies Buffer-backed native pixels before the transport clears its source', () => {
    bindComputerAgentTurn('buffer-owner', 'buffer-run', { id: 'visual', provider: 'test', api: 'openai-completions', baseUrl: 'https://model.test/v1', input: ['text', 'image'] } as any);
    const source = Buffer.from([1, 2, 3]);
    retainComputerFrame('buffer-owner', 'buffer-tool', source, 'image/png');
    source.fill(0);
    expect(computerImagesForRequest('buffer-owner', 'buffer-run', 'buffer-tool')).toEqual([{ type: 'image', data: 'AQID', mimeType: 'image/png' }]);
  });
  it('binds pixels to their actual owner, run, tool call and recipient', () => {
    bindComputerAgentTurn('one', 'run', model);
    retainComputerFrame('one', 'call', new Uint8Array([1, 2, 3]), 'image/png');
    expect(computerImagesForRequest('one', 'run', 'call')).toHaveLength(1);
    expect(computerImagesForRequest('one', 'other', 'call')).toEqual([]);
    expect(computerImagesForRequest('other', 'run', 'call')).toEqual([]);
    expect(computerImagesForRequest('one', 'run', 'other')).toEqual([]);
    bindComputerAgentTurn('one', 'run', { ...model, baseUrl: 'https://other.test/v1' });
    expect(computerImagesForRequest('one', 'run', 'call')).toEqual([]);
  });
  it('cleans only frames captured by a completed request, keeping newer tool results', () => {
    bindComputerAgentTurn('one', 'run', model);
    retainComputerFrame('one', 'old', new Uint8Array([1]), 'image/png');
    const release = computerRequestFrameCleanup('one', 'run');
    retainComputerFrame('one', 'new', new Uint8Array([2]), 'image/png');
    release();
    expect(computerImagesForRequest('one', 'run', 'new')).toHaveLength(1);
    clearComputerFrames('one');
    expect(computerImagesForRequest('one', 'run', 'new')).toEqual([]);
  });
  it('rejects a text-only main model', () => {
    bindComputerAgentTurn('one', 'run', { ...model, input: ['text'] });
    expect(() => computerAgentTurn('one')).toThrow('COMPUTER_AGENT_MODEL_REQUIRED');
  });
});
