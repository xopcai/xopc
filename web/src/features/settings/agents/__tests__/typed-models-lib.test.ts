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
          small: { model: 'deepseek/flash', description: 'Fast' },
          bad: { model: '' },
        },
      }),
    ).toEqual([{ id: 'small', model: 'deepseek/flash', description: 'Fast' }]);
  });

  it('cleanTypedModelsForPatch dedupes and returns null when empty', () => {
    expect(
      cleanTypedModelsForPatch([
        { id: 'small', model: 'openai/a', description: '' },
        { id: 'small', model: 'openai/b', description: 'x' },
      ]),
    ).toEqual({ roles: { small: { description: 'x', model: 'openai/b' } } });
    expect(cleanTypedModelsForPatch([])).toBeNull();
  });

  it('validateTypedModelsForSave catches invalid rows', () => {
    const msg = {
      invalidId: 'bad id',
      duplicateId: 'dup',
      invalidModel: 'bad model',
    };
    expect(validateTypedModelsForSave([], msg)).toBeNull();
    expect(validateTypedModelsForSave([{ id: 'Bad', model: 'openai/x', description: '' }], msg)).toBe(
      'bad id',
    );
    expect(
      validateTypedModelsForSave(
        [
          { id: 'small', model: 'openai/x', description: '' },
          { id: 'small', model: 'openai/y', description: '' },
        ],
        msg,
      ),
    ).toBe('dup');
  });

  it('formatTypedModelsSummary renders readable list', () => {
    expect(formatTypedModelsSummary([])).toBe('—');
    expect(formatTypedModelsSummary([{ id: 'small', model: 'openai/mini' }])).toBe(
      'small → openai/mini',
    );
  });
});
