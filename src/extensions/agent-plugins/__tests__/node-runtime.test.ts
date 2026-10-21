import { expect, it } from 'vitest';

import { pluginNodeRuntime } from '../node-runtime.js';

it('runs Node plugins in Electron Node mode for desktop hosts', () => {
  const original = Object.getOwnPropertyDescriptor(process.versions, 'electron');
  Object.defineProperty(process.versions, 'electron', { configurable: true, value: '42.4.1' });
  try {
    expect(pluginNodeRuntime('node')).toEqual({ command: process.execPath, env: { ELECTRON_RUN_AS_NODE: '1' } });
    expect(pluginNodeRuntime('node.exe')).toEqual(pluginNodeRuntime('node'));
    expect(pluginNodeRuntime('./node')).toEqual({ command: './node', env: {} });
    expect(pluginNodeRuntime('python3')).toEqual({ command: 'python3', env: {} });
  } finally {
    if (original) Object.defineProperty(process.versions, 'electron', original);
    else delete process.versions.electron;
  }
});
