import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const manifest = readFileSync(new URL('../entry/src/main/module.json5', import.meta.url), 'utf8');

describe('Harmony system share extension manifest', () => {
  it('registers file/image sharing and file open targets', () => {
    expect(manifest).toContain('"utd": "general.image"');
    expect(manifest).toContain('"utd": "com.adobe.pdf"');
    expect(manifest).toContain('"utd": "org.openxmlformats.wordprocessingml.document"');
    expect(manifest).toContain('"scheme": "file", "type": "image/*"');
  });
  it('registers a share extension for text and links', () => {
    expect(manifest).toContain('"type": "share"');
    expect(manifest).toContain('"srcEntry": "./ets/entryability/ShareExtensionAbility.ets"');
    expect(manifest).toContain('"ohos.want.action.sendData"');
    expect(manifest).toContain('"general.plain-text"');
    expect(manifest).toContain('"general.hyperlink"');
  });
});
