import { expect, it } from 'vitest';

import { ContainerNetworkFixture } from '../electron-network-fixture.mjs';

it('refuses unknown or arbitrary container targets before any networking command', () => {
  const owned = 'a'.repeat(64), other = 'b'.repeat(64);
  expect(() => new ContainerNetworkFixture(other, [owned])).toThrow(/owned test container/);
  expect(() => new ContainerNetworkFixture('production-server', [owned])).toThrow(/owned test container/);
  expect(() => new ContainerNetworkFixture(owned, [owned])).not.toThrow();
});
