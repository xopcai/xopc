import { describe, expect, it } from 'vitest';

import { argvWithDefaultCommand } from '../index.js';

describe('argvWithDefaultCommand', () => {
  it('defaults bare xopc to tui', () => {
    expect(argvWithDefaultCommand(['node', 'xopc'])).toEqual(['node', 'xopc', 'tui']);
  });

  it('keeps global options before the default tui command', () => {
    expect(argvWithDefaultCommand(['node', 'xopc', '--config', '/tmp/xopc.json'])).toEqual([
      'node',
      'xopc',
      '--config',
      '/tmp/xopc.json',
      'tui',
    ]);
  });

  it('does not rewrite help or version invocations', () => {
    expect(argvWithDefaultCommand(['node', 'xopc', '--help'])).toEqual(['node', 'xopc', '--help']);
    expect(argvWithDefaultCommand(['node', 'xopc', '-V'])).toEqual(['node', 'xopc', '-V']);
  });

  it('does not rewrite existing or unknown commands', () => {
    expect(argvWithDefaultCommand(['node', 'xopc', 'gateway'])).toEqual(['node', 'xopc', 'gateway']);
    expect(argvWithDefaultCommand(['node', 'xopc', 'unknown'])).toEqual(['node', 'xopc', 'unknown']);
  });
});
