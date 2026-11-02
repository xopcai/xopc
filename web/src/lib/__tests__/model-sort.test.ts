import { describe, expect, it } from 'vitest';

import { compareModelNamesDescending, compareModelsDescending } from '../model-sort';

describe('model dropdown sorting', () => {
  it('puts higher numeric versions first, including multi-digit versions', () => {
    expect(['GPT-5.9', 'GPT-4o', 'GPT-6.1 Sol', 'GPT-5.10', 'GPT-5'].sort(compareModelNamesDescending))
      .toEqual(['GPT-6.1 Sol', 'GPT-5.10', 'GPT-5.9', 'GPT-5', 'GPT-4o']);
  });

  it('puts newer dated variants first', () => {
    expect(['model-2025-01-02', 'model-2026-02-10', 'model-2026-02-09'].sort(compareModelNamesDescending))
      .toEqual(['model-2026-02-10', 'model-2026-02-09', 'model-2025-01-02']);
  });

  it('uses IDs to order models with identical display names', () => {
    const models = [{ id: 'provider/model-2', name: 'Model' }, { id: 'provider/model-10', name: 'Model' }];
    expect([...models].sort(compareModelsDescending).map(model => model.id))
      .toEqual(['provider/model-10', 'provider/model-2']);
    expect(models[0].id).toBe('provider/model-2');
  });
});
