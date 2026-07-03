import { describe, expect, it } from 'vitest';

import {
  cleanTypedModelsForPatch,
  formatTypedModelsSummary,
  parseTypedModelsFromConfig,
  validateTypedModelsForSave,
} from '../typed-models-lib';

describe('typed-models-lib', () => {
  it('parseTypedModelsFromConfig maps config roles', () => {
    expect(
      parseTypedModelsFromConfig({
        roles: {
          small: { model: 'deepseek/flash', fallbacks: ['openai/gpt-4o'], description: 'Fast' },
          bad: { model: '' },
        },
      }),
    ).toEqual([{ id: 'small', model: 'deepseek/flash', fallbacks: ['openai/gpt-4o'], description: 'Fast' }]);
  });

  it('cleanTypedModelsForPatch dedupes and returns null when empty', () => {
    expect(
      cleanTypedModelsForPatch([
        { id: 'small', model: 'openai/a', fallbacks: [], description: '' },
        { id: 'small', model: 'openai/b', fallbacks: ['openai/a', 'bad', 'openai/b', 'anthropic/c'], description: 'x' },
      ]),
    ).toEqual({ roles: { small: { description: 'x', model: 'openai/b', fallbacks: ['openai/a', 'anthropic/c'] } } });
    expect(cleanTypedModelsForPatch([])).toBeNull();
  });

  it('validateTypedModelsForSave catches invalid rows', () => {
    const msg = {
      invalidId: 'bad id',
      duplicateId: 'dup',
      invalidModel: 'bad model',
    };
    expect(validateTypedModelsForSave([], msg)).toBeNull();
    expect(validateTypedModelsForSave([{ id: 'Bad', model: 'openai/x', fallbacks: [], description: '' }], msg)).toBe(
      'bad id',
    );
    expect(
      validateTypedModelsForSave(
        [
          { id: 'small', model: 'openai/x', fallbacks: [], description: '' },
          { id: 'small', model: 'openai/y', fallbacks: [], description: '' },
        ],
        msg,
      ),
    ).toBe('dup');
    expect(
      validateTypedModelsForSave([{ id: 'small', model: 'openai/x', fallbacks: ['bad'], description: '' }], msg),
    ).toBe('bad model');
  });

  it('formatTypedModelsSummary renders readable list', () => {
    expect(formatTypedModelsSummary([])).toBe('—');
    expect(formatTypedModelsSummary([{ id: 'small', model: 'openai/mini', fallbacks: ['openai/full'] }])).toBe(
      'small -> openai/mini (+1)',
    );
  });
});
