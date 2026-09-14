import { expect, it } from 'vitest';
import { modelDisplayName } from '../model-display-name';

it('switches names on cached models and falls back for missing translations', () => {
  const model = { id: 'xopc-cloud/auto', name: 'Standard', displayNames: { 'zh-CN': '标准', en: 'Standard' } };
  expect(modelDisplayName(model, 'zh')).toBe('标准');
  expect(modelDisplayName(model, 'en')).toBe('Standard');
  expect(modelDisplayName({ name: 'Custom' }, 'zh')).toBe('Custom');
  expect(modelDisplayName({ name: 'Advanced', displayNames: { 'zh-CN': '高级' } }, 'en')).toBe('Advanced');
  expect(model.id).toBe('xopc-cloud/auto');
});
