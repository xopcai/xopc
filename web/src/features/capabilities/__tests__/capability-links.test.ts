import { expect, it } from 'vitest';
import { pluginDetailPath, pluginReturnPath } from '../capability-links';

it('preserves the entry point and only allows known internal return destinations', () => {
  expect(pluginDetailPath('sample', 'connections', true)).toBe('/capabilities/connectors?tab=connected&plugin=sample&connect=1');
  expect(pluginReturnPath('connections')).toContain('connectors?tab=connected');
  expect(pluginReturnPath('skills')).toContain('skills?tab=installed&source=plugin');
  expect(pluginReturnPath('https://evil.example')).toBe('/capabilities/extensions?tab=user');
});

it('keeps list filters when opening a plugin modal and replaces an existing modal target', () => {
  expect(pluginDetailPath('new/id', 'installed', false, '/capabilities/extensions?tab=user&q=CSV&plugin=old&connect=1')).toBe('/capabilities/extensions?tab=user&q=CSV&plugin=new%2Fid');
  expect(pluginDetailPath('sample', 'installed', false, 'https://evil.example')).toBe('/capabilities/extensions?tab=user&plugin=sample');
});
