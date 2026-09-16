import { expect, it } from 'vitest';
import { validateModelsConfig } from '../models-json.js';

it('validates GUI profiles against the effective model API and image input', () => {
  const config = (api: string, input: string[]) => ({ providers: { fixture: {
    api, baseUrl: 'https://fixture.test/v1', models: [{ id: 'gui', input, computerUse: { profile: 'structured-tools-v1' } }],
  } } });
  expect(validateModelsConfig(config('openai-completions', ['text', 'image'])).valid).toBe(true);
  expect(validateModelsConfig(config('openai-completions', ['text'])).valid).toBe(false);
  expect(validateModelsConfig(config('openai-responses', ['text', 'image'])).valid).toBe(false);
});
