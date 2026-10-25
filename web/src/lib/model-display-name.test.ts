import { expect, it } from 'vitest';
import { modelDisplayName } from './model-display-name';
it('localizes shipped Cloud aliases consistently while preserving custom names and supplied translations', () => {
  expect(modelDisplayName({ id: 'xopc-cloud/auto', name: 'Standard' }, 'zh')).toBe('标准');
  expect(modelDisplayName({ id: 'custom/auto', name: 'Standard' }, 'zh')).toBe('Standard');
  expect(modelDisplayName({ id: 'xopc-cloud/auto', name: 'My model' }, 'zh')).toBe('My model');
  expect(modelDisplayName({ name: 'Original', displayNames: { 'zh-CN': '翻译' } }, 'zh')).toBe('翻译');
});
