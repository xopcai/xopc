import { describe, expect, it } from 'vitest';

import { createInitialState } from '../../tui-types.js';
import {
  formatCwdForFooter,
  formatQueuedMessageLines,
  formatTokens,
  sanitizeStatusText,
} from '../tui-bottom-bar.js';
import { TuiBottomBar } from '../tui-bottom-bar.js';

describe('formatTokens', () => {
  it('formats sub-thousand literally', () => {
    expect(formatTokens(0)).toBe('0');
    expect(formatTokens(999)).toBe('999');
  });

  it('uses one decimal for 1k–10k', () => {
    expect(formatTokens(1500)).toBe('1.5k');
    expect(formatTokens(9999)).toBe('10.0k');
  });

  it('rounds whole k for 10k–1M', () => {
    expect(formatTokens(12_400)).toBe('12k');
    expect(formatTokens(205_000)).toBe('205k');
  });
});

describe('formatCwdForFooter', () => {
  it('replaces an exact home path with tilde', () => {
    expect(formatCwdForFooter('/Users/alice', '/Users/alice')).toBe('~');
  });

  it('replaces paths inside home with a tilde prefix', () => {
    expect(formatCwdForFooter('/Users/alice/work/project', '/Users/alice').replace(/\\/g, '/')).toBe(
      '~/work/project',
    );
  });

  it('does not shorten sibling paths with the same string prefix', () => {
    expect(formatCwdForFooter('/Users/alice-archive/project', '/Users/alice')).toBe(
      '/Users/alice-archive/project',
    );
  });

  it('leaves non-home paths unchanged', () => {
    expect(formatCwdForFooter('/opt/project', '/Users/alice')).toBe('/opt/project');
  });
});

describe('sanitizeStatusText', () => {
  it('keeps extension status text on one compact line', () => {
    expect(sanitizeStatusText('sync\nready\t ok\r done')).toBe('sync ready ok done');
  });
});

describe('formatQueuedMessageLines', () => {
  it('renders compaction queued messages as generic queued prompts', () => {
    const state = createInitialState('agent:main:main');
    state.compactionQueue.push('after compact');

    const rendered = formatQueuedMessageLines(state, 120).join('\n');

    expect(rendered).toContain('Queued: after compact');
  });
});

describe('TuiBottomBar', () => {
  it('renders context usage with the context window', () => {
    const state = createInitialState('agent:main:main');
    state.connectionStatus = 'connected';
    state.sessionInfo = {
      model: 'gpt-test',
      modelProvider: 'openai',
      contextUsagePercent: 50,
      contextWindow: 100_000,
    };
    const bar = new TuiBottomBar(() => state, () => 'medium');

    expect(bar.render(120).join('\n')).toContain('50%/100k ctx');
  });

  it('renders pending input count', () => {
    const state = createInitialState('agent:main:main');
    state.connectionStatus = 'connected';
    state.pendingInputCount = 1;
    const bar = new TuiBottomBar(() => state, () => 'medium');

    expect(bar.render(120).join('\n')).toContain('Q1');
  });

  it('renders user-facing active run status', () => {
    const state = createInitialState('agent:main:main');
    state.connectionStatus = 'connected';
    state.activityStatus = 'stalled';
    state.runStatus = {
      ...state.runStatus,
      phase: 'stalled',
      runId: 'run-1',
    };
    state.activeRunId = 'run-1';
    const bar = new TuiBottomBar(() => state, () => 'medium');

    expect(bar.render(120).join('\n')).toContain('Output stale');
    expect(bar.render(120).join('\n')).toContain('esc to interrupt');

    state.activityStatus = 'recovering';
    state.runStatus.phase = 'recovering';
    expect(bar.render(120).join('\n')).toContain('Reconnecting output');

    state.activityStatus = 'streaming';
    state.runStatus.phase = 'streaming';
    state.runStatus.source = 'realtime-run';
    expect(bar.render(120).join('\n')).toContain('Working');
  });

  it('does not render server-owned input contents in the footer', () => {
    const state = createInitialState('agent:main:main');
    state.connectionStatus = 'connected';
    state.pendingInputCount = 1;
    const bar = new TuiBottomBar(() => state, () => 'medium');

    const rendered = bar.render(120).join('\n');

    expect(rendered).toContain('Q1');
    expect(rendered).not.toContain('Follow-up:');
  });

  it('renders extension statuses on a separate compact line', () => {
    const state = createInitialState('agent:main:main');
    state.connectionStatus = 'connected';
    state.sessionInfo = { model: 'gpt-test', modelProvider: 'openai' };
    const bar = new TuiBottomBar(() => state, () => 'medium');
    bar.setExtensionStatusParts(['sync\nready', 'lint ok']);

    const lines = bar.render(120).map((line) => line.replace(/\x1b\[[0-9;]*m/g, ''));

    expect(lines[1]).toContain('connected');
    expect(lines[1]).not.toContain('sync ready');
    expect(lines[2]).toBe('sync ready lint ok');
  });
});
