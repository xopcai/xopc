// @vitest-environment jsdom
import { expect, it } from 'vitest';
import { buildPickerModels } from '../model-selector';
import type { ConfiguredModel } from '@/features/chat/api/registry-api';

const models: ConfiguredModel[] = [
  { id: 'xopc-cloud/advanced', name: 'Advanced', provider: 'xopc-cloud', vision: true },
  { id: 'xopc-cloud/gui', name: 'GUI', provider: 'xopc-cloud', vision: true, computerUse: { profile: 'gui-plus-2026-02-26' } },
  { id: 'byok/gui', name: 'GUI BYOK', provider: 'byok', vision: true, computerUse: { profile: 'structured-tools-v1' } },
];
it('offers both Cloud and BYOK GUI models without promoting a missing or incompatible current selection', () => {
  expect(buildPickerModels(models, 'computer-use', 'xopc-cloud/advanced').map(m => m.id)).toEqual(['xopc-cloud/gui', 'byok/gui']);
  expect(buildPickerModels([], 'computer-use', 'gone/gui')).toEqual([]);
});
it('keeps dedicated GUI models out of ordinary chat and vision choices', () => {
  expect(buildPickerModels(models, undefined, '').map(m => m.id)).toEqual(['xopc-cloud/advanced']);
  expect(buildPickerModels(models, 'vision', '').map(m => m.id)).toEqual(['xopc-cloud/advanced']);
});
