import { describe, expect, it, vi } from 'vitest';
import { ConfigSchema } from '../../config/schema.js';
import { computerModelProfile } from '../model-policy.js';
import { validateComputerModelChanges } from '../model-config.js';

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
    expect(() => ConfigSchema.parse({ agents: { defaults: { models: { chat: { primary: 'cloud/chat' },
      computerUse: { primary: 'cloud/gui', fallbacks: ['other/gui'] } } } } })).toThrow('does not support fallback');
  });
  it('validates newly selected models without blocking unrelated edits for withdrawn models', () => {
    const previous = ConfigSchema.parse({});
    const next = structuredClone(previous);
    next.agents.defaults.models.computerUse = { primary: 'cloud/chat', fallbacks: [] };
    expect(() => validateComputerModelChanges(next, previous)).toThrow('supported Computer Use');
    expect(() => validateComputerModelChanges(next, next)).not.toThrow();
    next.agents.defaults.models.computerUse.primary = 'cloud/gui';
    expect(() => validateComputerModelChanges(next, previous)).not.toThrow();
    next.agents.list[0].models = { computerUse: { primary: 'cloud/chat', fallbacks: [] } };
    expect(() => validateComputerModelChanges(next, previous)).toThrow('supported Computer Use');
  });
});
