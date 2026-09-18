import { describe, expect, it } from 'vitest';

import { checkEngineCompatibility } from '../engine-check.js';
import { checkExtensionApiCompatibility } from '../api-version.js';

describe('checkEngineCompatibility', () => {
  it('accepts exact match', () => {
    const r = checkEngineCompatibility('1.2.3', '1.2.3');
    expect(r.compatible).toBe(true);
    expect(r.parseWarning).toBeUndefined();
  });

  it('rejects when below >= range', () => {
    const r = checkEngineCompatibility('0.1.0', '>=1.0.0');
    expect(r.compatible).toBe(false);
  });

  it('accepts caret range', () => {
    expect(checkEngineCompatibility('1.5.0', '^1.2.3').compatible).toBe(true);
    expect(checkEngineCompatibility('2.0.0', '^1.2.3').compatible).toBe(false);
  });

  it('accepts composite range', () => {
    expect(checkEngineCompatibility('1.5.0', '>=1.0.0 <2.0.0').compatible).toBe(true);
    expect(checkEngineCompatibility('2.0.0', '>=1.0.0 <2.0.0').compatible).toBe(false);
  });
});

describe('checkExtensionApiCompatibility', () => {
  it('enforces declared API ranges', () => {
    expect(checkExtensionApiCompatibility('^1.0.0', '1.0.0', 'extensionApi').compatible).toBe(true);
    expect(checkExtensionApiCompatibility('>=2.0.0', '1.0.0', 'extensionApi').compatible).toBe(false);
  });

  it('rejects ranges the host cannot parse', () => {
    const result = checkExtensionApiCompatibility('1.x', '1.0.0', 'extensionUiApi');
    expect(result.parseWarning).toBe(true);
  });
});
