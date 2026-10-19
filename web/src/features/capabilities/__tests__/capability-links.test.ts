import { expect, it } from 'vitest';
import { pluginDetailPath, pluginReturnPath } from '../capability-links';

it('preserves the entry point and only allows known internal return destinations', () => {
  expect(pluginDetailPath('sample', 'connections', true)).toBe('/capabilities/extensions/sample?from=connections&connect=1');
  expect(pluginReturnPath('connections')).toContain('connectors?tab=connected');
  expect(pluginReturnPath('skills')).toContain('skills?tab=installed&source=plugin');
  expect(pluginReturnPath('https://evil.example')).toBe('/capabilities/extensions?tab=user');
});
