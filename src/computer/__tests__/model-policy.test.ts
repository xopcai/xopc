import { describe, expect, it, vi } from 'vitest';
import { ComputerModelRouteSchema } from '../../agent-config/index.js';
import { computerModelProfile } from '../model-policy.js';
import { validateComputerModelChange } from '../model-config.js';

vi.mock('../../providers/index.js', () => ({ resolveModel: vi.fn((ref: string) => ref === 'cloud/gui'
  ? { api: 'openai-completions', input: ['image'], computerUse: { profile: 'structured-tools-v1' } }
  : { api: 'openai-completions', input: ['image'] }) }));

describe('computer model policy', () => {
  it('requires both the supported action protocol and compatible inference API', () => {
    const model = { api: 'openai-completions', input: ['image'], computerUse: { profile: 'structured-tools-v1' } };
    expect(computerModelProfile(model)).toBe('structured-tools-v1');
    for (const invalid of [{ ...model, input: ['text'] }, { ...model, api: 'openai-responses' },
      { ...model, computerUse: undefined }, { ...model, computerUse: { profile: 'future' } }]) {
      expect(computerModelProfile(invalid)).toBeUndefined();
    }
  });
  it('accepts the native OpenAI computer protocol only on the Responses API', () => {
    const model = { api: 'openai-responses', input: ['text', 'image'], computerUse: { profile: 'openai-responses-computer-v1' } };
    expect(computerModelProfile(model)).toBe('openai-responses-computer-v1');
    expect(computerModelProfile({ ...model, api: 'openai-completions' })).toBeUndefined();
  });
  it('rejects implicit fallback configuration at the schema boundary', () => {
    expect(() => ComputerModelRouteSchema.parse({
      primary: 'cloud/gui', fallbacks: ['other/gui'],
    })).toThrow('does not support fallback');
  });
  it('validates newly selected models without blocking unrelated edits for withdrawn models', () => {
    const previous = { primary: 'withdrawn/gui', fallbacks: [] };
    const invalid = { primary: 'cloud/chat', fallbacks: [] };
    expect(() => validateComputerModelChange(invalid, previous)).toThrow('supported Computer Use');
    expect(() => validateComputerModelChange(invalid, invalid)).not.toThrow();
    expect(() => validateComputerModelChange({ primary: 'cloud/gui', fallbacks: [] }, previous)).not.toThrow();
  });
});
