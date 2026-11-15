import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

const sourceRoot = new URL('../entry/src/main/ets/', import.meta.url);

function arkUiSources(directory: string): string[] {
  const files: string[] = [];
  for (const entry of readdirSync(directory, { withFileTypes: true })) {
    const path = join(directory, entry.name);
    if (entry.isDirectory()) files.push(...arkUiSources(path));
    else if (entry.name.endsWith('.ets')) files.push(path);
  }
  return files;
}

describe('color-based visual hierarchy', () => {
  it('separates application regions by fill and uses semantic strokes for cards and controls', () => {
    for (const file of arkUiSources(sourceRoot.pathname)) {
      const source = readFileSync(file, 'utf8');
      for (const stroke of source.matchAll(/\.border\(([^\n]*)\)/g)) {
        expect(stroke[1], file).toMatch(/this\.colors\.(panel|control|attention)Stroke/);
      }
      const radiusBeforeStroke = /\.borderRadius\((?:[^()\n]|\([^()\n]*\))*\)[^\n]*(?:\n[ \t]+\.[^\n]*)*\.border\(/;
      expect(source, file).not.toMatch(radiusBeforeStroke);
      expect(source, file).not.toMatch(/\bDivider\s*\(/);
      expect(source, file).not.toMatch(/\.divider\s*\(/);
    }
  });

  it('uses semantic surface colors for shared settings and list rows', () => {
    const components = readFileSync(new URL('../entry/src/main/ets/view/MobileComponents.ets', import.meta.url), 'utf8');
    const settings = readFileSync(new URL('../entry/src/main/ets/view/SettingsView.ets', import.meta.url), 'utf8');

    expect(components).toContain('.backgroundColor(this.attention ? this.colors.attentionFill : this.colors.panel)');
    expect(components).toContain('.border(this.colors.controlStroke).borderRadius(this.colors.corner(23)).fontColor(this.colors.foreground)');
    expect(settings).toContain('selected ? this.colors.accentSoft : this.colors.panel');
    expect(settings).toContain('this.selectedScheme === scheme ? this.colors.accentSoft : this.colors.panel');
  });
});
