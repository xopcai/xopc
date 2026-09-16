import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

describe('HarmonyOS compatibility and signing boundary', () => {
  const profile = JSON.parse(readFileSync(new URL('../build-profile.json5', import.meta.url), 'utf8'));

  it('keeps Mate 60 HarmonyOS 6.1 within the minimum supported version', () => {
    const product = profile.app.products.find((item: { name: string }) => item.name === 'default');
    expect(product.compatibleSdkVersion).toBe('6.1.0(23)');
    expect(product.targetSdkVersion).toBe('26.0.0');
    expect(product.runtimeOS).toBe('HarmonyOS');
  });

  it('keeps local signing credentials outside the tracked build configuration', () => {
    expect(profile.app.signingConfigs).toEqual([]);
  });
});
