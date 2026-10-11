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
  it('does not use strokes or divider lines to separate application regions', () => {
    for (const file of arkUiSources(sourceRoot.pathname)) {
      let source = readFileSync(file, 'utf8');
      if (file.endsWith('/ChatView.ets')) {
        // Capsule outlines distinguish header controls; application regions still use color layers.
        const start = source.lastIndexOf('      if (!this.embedded) {');
        const end = source.indexOf('    if (this.sendFlightActive)', start);
        const header = source.slice(start, end);
        expect(header.match(/\.border\s*\(/g)).toHaveLength(2);
        source = source.slice(0, start) + header.replace(/\.border\(\{ width: 1, color: this.colors.border \}\)/g, '') + source.slice(end);
      }
      expect(source, file).not.toMatch(/\.border\s*\(/);
      expect(source, file).not.toMatch(/\bDivider\s*\(/);
      expect(source, file).not.toMatch(/\.divider\s*\(/);
    }
  });

  it('uses semantic surface colors for shared settings and list rows', () => {
    const components = readFileSync(new URL('../entry/src/main/ets/view/MobileComponents.ets', import.meta.url), 'utf8');
    const settings = readFileSync(new URL('../entry/src/main/ets/view/SettingsView.ets', import.meta.url), 'utf8');

    expect(components).toContain('.backgroundColor(this.colors.panel)');
    expect(settings).toContain('selected ? this.colors.accentSoft : this.colors.panel');
    expect(settings).toContain('this.selectedScheme === scheme ? this.colors.accentSoft : this.colors.panel');
  });
});
