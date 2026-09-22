import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const manifest = readFileSync(new URL('../entry/src/main/module.json5', import.meta.url), 'utf8');

describe('Harmony system share extension manifest', () => {
  it('registers a share extension for text and links', () => {
    expect(manifest).toContain('"type": "share"');
    expect(manifest).toContain('"srcEntry": "./ets/entryability/ShareExtensionAbility.ets"');
    expect(manifest).toContain('"ohos.want.action.sendData"');
    expect(manifest).toContain('"general.plain-text"');
    expect(manifest).toContain('"general.hyperlink"');
  });
});
