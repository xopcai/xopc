import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const read = (path: string): string => readFileSync(new URL(path, import.meta.url), 'utf8');
const indexView = read('../entry/src/main/ets/pages/Index.ets');
const moduleProfile = read('../entry/src/main/module.json5');

describe('Harmony startup flow', () => {
  it('renders the main page immediately while restoring connection state', () => {
    expect(indexView).toContain('aboutToAppear(): void { this.restoreConnection(); }');
    expect(indexView).toContain('await this.connection.restore();');
    expect(indexView).not.toContain('launchVisible');
    expect(indexView).not.toContain('launchOverlay');
  });

  it('does not add timers or custom animation over the first interactive frame', () => {
    expect(indexView).not.toContain('startLaunchAnimation');
    expect(indexView).not.toContain('dismissLaunch');
    expect(indexView).not.toContain('setTimeout');
    expect(indexView).not.toContain('animateTo');
  });

  it('keeps the system start window as the only launch placeholder', () => {
    expect(moduleProfile).toContain('"startWindowIcon": "$media:launch_logo"');
    expect(moduleProfile).toContain('"startWindowBackground": "$color:surface"');
  });
});
