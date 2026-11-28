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
  it('separates application surfaces without decorative borders, shadows, or dividers', () => {
    for (const file of arkUiSources(sourceRoot.pathname)) {
      const source = readFileSync(file, 'utf8');
      expect(source, file).not.toMatch(/\.(?:border|outline|shadow)\s*\(/);
      expect(source, file).not.toMatch(/\bDivider\s*\(/);
      expect(source, file).not.toMatch(/\.divider\s*\(/);
    }
  });

  it('uses semantic surface colors for shared settings and list rows', () => {
    const components = readFileSync(new URL('../entry/src/main/ets/view/MobileComponents.ets', import.meta.url), 'utf8');
    const settings = readFileSync(new URL('../entry/src/main/ets/view/SettingsView.ets', import.meta.url), 'utf8');

    expect(components).toContain('.backgroundColor(this.attention ? this.colors.attentionFill : this.colors.panel)');
    expect(components).toContain('.backgroundColor(this.colors.input)\n      .borderRadius(this.colors.corner(23)).fontColor(this.colors.foreground)');
    expect(settings).toContain('selected ? this.colors.accentSoft : this.colors.panel');
    expect(settings).toContain('this.selectedScheme === scheme ? this.colors.accentSoft : this.colors.panel');
  });

  it('sets an explicit theme backgroundColor on every NavDestination so safe areas never fall back to white', () => {
    const missing: string[] = [];
    for (const file of arkUiSources(sourceRoot.pathname)) {
      const source = readFileSync(file, 'utf8');
      let searchIndex = 0;
      while (true) {
        const start = source.indexOf('NavDestination()', searchIndex);
        if (start < 0) break;
        const openBrace = source.indexOf('{', start);
        if (openBrace < 0) break;
        let depth = 0;
        let closeBrace = -1;
        for (let i = openBrace; i < source.length; i++) {
          if (source[i] === '{') depth++;
          else if (source[i] === '}') {
            depth--;
            if (depth === 0) {
              closeBrace = i;
              break;
            }
          }
        }
        expect(closeBrace, file).toBeGreaterThan(openBrace);
        let cursor = closeBrace + 1;
        let hasBackgroundColor = false;
        while (cursor < source.length) {
          while (cursor < source.length && /\s/.test(source[cursor])) cursor++;
          if (source[cursor] !== '.') break;
          const match = /^\.([a-zA-Z0-9_]+)\s*\(/.exec(source.slice(cursor));
          if (!match) break;
          if (match[1] === 'backgroundColor') {
            hasBackgroundColor = true;
            break;
          }
          let parenDepth = 0;
          let i = cursor + match[0].length - 1;
          for (; i < source.length; i++) {
            if (source[i] === '(') parenDepth++;
            else if (source[i] === ')') {
              parenDepth--;
              if (parenDepth === 0) break;
            }
          }
          cursor = i + 1;
        }
        if (!hasBackgroundColor) {
          const line = source.slice(0, start).split('\n').length;
          missing.push(`${file}:${line}`);
        }
        searchIndex = closeBrace + 1;
      }
    }
    expect(missing).toEqual([]);
  });
});
