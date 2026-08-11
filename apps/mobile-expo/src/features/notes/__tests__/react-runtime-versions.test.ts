import { createRequire } from 'node:module';

import { describe, expect, it } from 'vitest';

const require = createRequire(import.meta.url);

function packageVersion(packageName: string): string {
  return (require(`${packageName}/package.json`) as { version: string }).version;
}

describe('note editor DOM runtime', () => {
  it('uses matching React and React DOM versions', () => {
    expect(packageVersion('react-dom')).toBe(packageVersion('react'));
  });
});
