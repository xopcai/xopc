import { describe, expect, it } from 'vitest';

import { cloudWireUsage } from '../cloud-wire.js';
import type { AssistantMessage } from '@earendil-works/pi-ai/compat';
import { vi } from 'vitest';
import { continuesAfterTool, finishAiUsageFromMessage } from '../recorder.js';
import { classifyCostSource } from '../cost.js';

describe('AI usage recorder', () => {
  it('does not reinterpret Cloud Credit prices as provider dollar estimates', () => {
    expect(classifyCostSource({ provider: 'xopc-cloud', id: 'cloud', baseUrl: 'https://router.xopc.ai/v1', cost: { input: 1, output: 4, cacheRead: 0, cacheWrite: 0 } })).toBe('unknown');
    expect(classifyCostSource({ provider: 'openai', id: 'byok', baseUrl: 'https://api.openai.com/v1', cost: { input: 1, output: 4, cacheRead: 0, cacheWrite: 0 } })).toBe('model_catalog');
  });
  it('classifies only the immediately preceding request context as a tool continuation', () => {
    expect(continuesAfterTool([{ role: 'user' }, { role: 'assistant' }, { role: 'toolResult' }])).toBe(true);
    expect(continuesAfterTool([
      { role: 'user' }, { role: 'assistant' }, { role: 'toolResult' }, { role: 'assistant' }, { role: 'user' },
    ])).toBe(false);
  });
  it('does not persist the SDK zero default as observed usage for a canceled Cloud request', () => {
    const finish = vi.fn();
    const message = {stopReason:'aborted',usage:{input:0,output:0,totalTokens:0}} as AssistantMessage;
    cloudWireUsage().apply(message);
    finishAiUsageFromMessage({id:'test',run:fn=>fn(),finish},message);
    expect(finish).toHaveBeenCalledWith(expect.objectContaining({status:'aborted',usage:undefined}));
  });

});
