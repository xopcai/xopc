import { describe, expect, it, vi } from 'vitest';
import type { Component } from '@earendil-works/pi-tui';
import { setKeybindings } from '@earendil-works/pi-tui';

import { SearchableSelectList } from '../components/searchable-select-list.js';
import { XopcKeybindingsManager } from '../tui-keybindings-file.js';
import {
  formatModelPickerHint,
  ModelPickerSelectList,
  modelPickerSelectItems,
  openModelPickerOverlay,
} from '../tui-model-picker.js';
import {
  formatScopedModelsOpenedHint,
  formatScopedModelsSavedHint,
  formatReviewPickerOpenedHint,
  formatSettingsOpenedHint,
  formatSessionTreeOpenedHint,
  formatThinkingLevelSavedHint,
  formatThinkingSelectorHint,
  openReviewLauncherOverlay,
} from '../tui-picker-overlay.js';
import {
  formatTranscriptTreeHelpLines,
  formatTranscriptTreeFilterHint,
  formatTranscriptTreeOpenedHint,
  formatUserMessageForkOpenedHint,
} from '../tui-transcript-tree-picker.js';

const testSelectTheme = {
  selectedText: (text: string) => text,
  description: (text: string) => text,
  noMatch: (text: string) => text,
  scrollInfo: (text: string) => text,
  searchPrompt: (text: string) => text,
  searchInput: (text: string) => text,
  matchHighlight: (text: string) => text,
};

describe('tui picker overlay basics', () => {
it('prefilters searchable picker rows from an initial query', () => {
    const list = new SearchableSelectList(
      [
        { value: 'openai/gpt-5', label: 'GPT-5', description: 'openai' },
        { value: 'anthropic/claude-sonnet-4', label: 'Claude Sonnet 4', description: 'anthropic' },
      ],
      10,
      testSelectTheme,
      { initialQuery: 'sonnet' },
    );

    const searchLine = list.render(80)[0]?.replace(/\x1b\[[0-9;]*m/g, '');

    expect(list.getSelectedItem()?.value).toBe('anthropic/claude-sonnet-4');
    expect(searchLine).toContain('search:');
    expect(searchLine).toContain('sonnet');
  });

  it('keeps searchable picker navigation clamped by default', () => {
    const list = new SearchableSelectList(
      [
        { value: 'a', label: 'A' },
        { value: 'b', label: 'B' },
      ],
      10,
      testSelectTheme,
    );

    list.handleInput('\x1b[A');
    expect(list.getSelectedItem()?.value).toBe('a');
    list.handleInput('\x1b[B');
    list.handleInput('\x1b[B');
    expect(list.getSelectedItem()?.value).toBe('b');
  });

  it('wraps searchable picker navigation when enabled', () => {
    const list = new SearchableSelectList(
      [
        { value: 'a', label: 'A' },
        { value: 'b', label: 'B' },
      ],
      10,
      testSelectTheme,
      { wrapNavigation: true },
    );

    list.handleInput('\x1b[A');
    expect(list.getSelectedItem()?.value).toBe('b');
    list.handleInput('\x1b[B');
    expect(list.getSelectedItem()?.value).toBe('a');
  });

  it('pages searchable picker navigation by the visible row count', () => {
    const list = new SearchableSelectList(
      Array.from({ length: 8 }, (_, index) => ({
        value: String(index),
        label: `Item ${index}`,
      })),
      3,
      testSelectTheme,
    );

    list.handleInput('\x1b[6~');
    expect(list.getSelectedItem()?.value).toBe('3');

    list.handleInput('\x1b[6~');
    expect(list.getSelectedItem()?.value).toBe('6');

    list.handleInput('\x1b[6~');
    expect(list.getSelectedItem()?.value).toBe('7');

    list.handleInput('\x1b[5~');
    expect(list.getSelectedItem()?.value).toBe('4');

    list.handleInput('\x1b[5~');
    list.handleInput('\x1b[5~');
    expect(list.getSelectedItem()?.value).toBe('0');
  });

  it('normalizes searchable picker descriptions to one rendered row', () => {
    const list = new SearchableSelectList(
      [
        {
          value: 'a',
          label: 'Alpha',
          description: 'first line\n\nsecond\tline',
        },
      ],
      10,
      testSelectTheme,
    );

    const rendered = list.render(80);
    expect(rendered).toHaveLength(3);
    expect(rendered.join('\n')).toContain('first line second line');
  });

  it('uses configured tui select keybindings in searchable pickers', () => {
    setKeybindings(
      new XopcKeybindingsManager({
        'tui.select.down': 'x',
        'tui.select.up': 'z',
        'tui.select.confirm': 's',
        'tui.select.cancel': 'q',
      }),
    );
    try {
      let selected = '';
      let cancelled = false;
      const list = new SearchableSelectList(
        [
          { value: 'a', label: 'A' },
          { value: 'b', label: 'B' },
        ],
        10,
        testSelectTheme,
      );
      list.onSelect = (item) => {
        selected = item.value;
      };
      list.onCancel = () => {
        cancelled = true;
      };

      list.handleInput('x');
      expect(list.getSelectedItem()?.value).toBe('b');
      list.handleInput('z');
      expect(list.getSelectedItem()?.value).toBe('a');
      list.handleInput('x');
      list.handleInput('s');
      expect(selected).toBe('b');
      list.handleInput('q');
      expect(cancelled).toBe(true);
    } finally {
      setKeybindings(new XopcKeybindingsManager());
    }
  });

  it('clears searchable picker queries while preserving selected value', () => {
    const list = new SearchableSelectList(
      [
        { value: 'a', label: 'Alpha' },
        { value: 'b', label: 'Bravo' },
      ],
      10,
      testSelectTheme,
    );

    list.handleInput('b');
    expect(list.getSelectedItem()?.value).toBe('b');

    list.clearSearch({ selectedValue: 'b' });

    expect(list.getSearchQuery()).toBe('');
    expect(list.getSelectedItem()?.value).toBe('b');
  });

  it('reports searchable picker selection stats', () => {
    const list = new SearchableSelectList(
      [
        { value: 'a', label: 'Alpha' },
        { value: 'b', label: 'Bravo' },
      ],
      10,
      testSelectTheme,
    );

    expect(list.getSelectionStats()).toEqual({ selected: 1, total: 2 });
    list.handleInput('\x1b[B');
    expect(list.getSelectionStats()).toEqual({ selected: 2, total: 2 });
    list.handleInput('zzz');
    expect(list.getSelectionStats()).toEqual({ selected: 0, total: 0 });
  });

  it('marks and sorts the current model first in the model picker', () => {
    const items = modelPickerSelectItems(
      [
        { provider: 'openai', id: 'gpt-5', name: 'GPT-5' },
        { provider: 'anthropic', id: 'claude-sonnet-4', name: 'Claude Sonnet 4' },
      ],
      { sessionInfo: { modelProvider: 'anthropic', model: 'claude-sonnet-4' } },
    );

    expect(items[0]).toMatchObject({
      value: 'anthropic/claude-sonnet-4',
      label: '✓ claude-sonnet-4',
      description: 'anthropic · Claude Sonnet 4 · current',
    });
    expect(items[0]?.searchText).toContain('anthropic/claude-sonnet-4');
  });

  it('defaults model picker to scoped models and toggles all models with Tab', () => {
    const models = [
      { provider: 'openai', id: 'gpt-5', name: 'GPT-5' },
      { provider: 'anthropic', id: 'claude-sonnet-4', name: 'Claude Sonnet 4' },
      { provider: 'google', id: 'gemini-2.5-pro', name: 'Gemini 2.5 Pro' },
    ];
    const picker = new ModelPickerSelectList(
      models,
      { sessionInfo: { modelProvider: 'openai', model: 'gpt-5' } },
      ['anthropic/claude-sonnet-4'],
    );

    expect(picker.getSelectedItem()?.value).toBe('anthropic/claude-sonnet-4');
    expect(picker.render(120).join('\n')).toContain('Scope:');

    picker.handleInput('\t');
    expect(picker.getSelectedItem()?.value).toBe('openai/gpt-5');
  });

  it('uses configured input tab binding for model picker scope toggling', () => {
    setKeybindings(new XopcKeybindingsManager());
    const models = [
      { provider: 'openai', id: 'gpt-5', name: 'GPT-5' },
      { provider: 'anthropic', id: 'claude-sonnet-4', name: 'Claude Sonnet 4' },
    ];
    const picker = new ModelPickerSelectList(
      models,
      { sessionInfo: { modelProvider: 'openai', model: 'gpt-5' } },
      ['anthropic/claude-sonnet-4'],
      undefined,
      new XopcKeybindingsManager({ 'tui.input.tab': 'x' }),
    );

    expect(picker.getSelectedItem()?.value).toBe('anthropic/claude-sonnet-4');
    expect(picker.render(120).join('\n')).toContain('X scope');
    picker.handleInput('x');
    expect(picker.getSelectedItem()?.value).toBe('openai/gpt-5');
  });

  it('uses the full model picker window after toggling from scoped to all', () => {
    const models = Array.from({ length: 4 }, (_, index) => ({
      provider: 'p',
      id: `model-${index + 1}`,
      name: `Model ${index + 1}`,
    }));
    const picker = new ModelPickerSelectList(
      models,
      { sessionInfo: { modelProvider: 'p', model: 'model-1' } },
      ['p/model-4'],
    );

    expect(picker.render(120).join('\n')).not.toContain('Model 2');
    picker.handleInput('\t');
    const rendered = picker.render(120).join('\n');

    expect(rendered).toContain('Model 1');
    expect(rendered).toContain('Model 2');
    expect(rendered).toContain('Model 3');
    expect(rendered).toContain('Model 4');
  });

  it('ignores stale scoped model refs that are missing from the catalog', () => {
    const models = [
      { provider: 'openai', id: 'gpt-5', name: 'GPT-5' },
      { provider: 'anthropic', id: 'claude-sonnet-4', name: 'Claude Sonnet 4' },
    ];
    const picker = new ModelPickerSelectList(
      models,
      { sessionInfo: { modelProvider: 'openai', model: 'gpt-5' } },
      ['missing/model'],
    );

    const rendered = picker.render(120).join('\n');
    expect(rendered).not.toContain('Scope:');
    expect(rendered).toContain('GPT-5');
    expect(rendered).toContain('Claude Sonnet 4');

    picker.handleInput('\t');
    expect(picker.getSelectedItem()?.value).toBe('openai/gpt-5');
  });

  it('switches the selected model locally instead of sending a slash command to the agent', async () => {
    let selector: Component | undefined;
    const sendMessage = vi.fn();
    const switchModel = vi.fn(async () => {});
    const svc = {
      client: {
        listModels: vi.fn(async () => [
          { provider: 'openai', id: 'gpt-5', name: 'GPT-5' },
        ]),
      },
      state: { sessionInfo: {} },
      setModelChoices: vi.fn(),
      getScopedModelRefs: () => null,
      openEditorSelector: (component: Component) => {
        selector = component;
        return vi.fn();
      },
      closeOverlay: vi.fn(),
      tui: { requestRender: vi.fn(), setFocus: vi.fn() },
      editor: { handleInput: vi.fn() },
      chatLog: { addSystem: vi.fn(), addBranchSummary: vi.fn() },
      sendMessage,
      switchModel,
      keybindings: new XopcKeybindingsManager(),
    } as never;

    await openModelPickerOverlay(svc);
    selector?.handleInput?.('\r');

    await vi.waitFor(() => expect(switchModel).toHaveBeenCalledWith('openai/gpt-5'));
    expect(sendMessage).not.toHaveBeenCalled();
  });

  it('opens review presets and sends a selected commit review command', async () => {
    let overlay: Component | undefined;
    const sendMessage = vi.fn();
    const svc = {
      client: {
        getReviewContext: vi.fn(async () => ({
          cwd: '/repo',
          defaultBaseBranch: 'main',
          status: { changedFiles: 1, untrackedFiles: 1, isClean: false },
          branches: [
            { name: 'feature', current: true },
            { name: 'main' },
          ],
          commits: [
            {
              sha: 'abc123def456',
              shortSha: 'abc123d',
              subject: 'feat: review picker',
              date: '2026-07-08T00:00:00.000Z',
            },
          ],
        })),
      },
      state: { currentSessionKey: 'agent:main:main', sessionInfo: {} },
      openOverlay: (component: Component) => {
        overlay = component;
      },
      closeOverlay: vi.fn(),
      tui: { requestRender: vi.fn(), setFocus: vi.fn() },
      editor: { handleInput: vi.fn() },
      chatLog: { addSystem: vi.fn(), addBranchSummary: vi.fn() },
      sendMessage,
      setEditorText: vi.fn(),
      keybindings: new XopcKeybindingsManager(),
    } as never;

    await openReviewLauncherOverlay(svc);
    overlay?.handleInput?.('\x1b[B');
    overlay?.handleInput?.('\x1b[B');
    overlay?.handleInput?.('\r');
    overlay?.handleInput?.('\r');

    expect(sendMessage).toHaveBeenCalledWith('/review --commit abc123def456');
  });

  it('returns from a review commit selector to review presets on cancel', async () => {
    let overlay: Component | undefined;
    const closeOverlay = vi.fn();
    const svc = {
      client: {
        getReviewContext: vi.fn(async () => ({
          cwd: '/repo',
          defaultBaseBranch: 'main',
          status: { changedFiles: 1, untrackedFiles: 0, isClean: false },
          branches: [{ name: 'main' }],
          commits: [
            {
              sha: 'abc123def456',
              shortSha: 'abc123d',
              subject: 'feat: review picker',
              date: '2026-07-08T00:00:00.000Z',
            },
          ],
        })),
      },
      state: { currentSessionKey: 'agent:main:main', sessionInfo: {} },
      openOverlay: (component: Component) => {
        overlay = component;
      },
      closeOverlay,
      tui: { requestRender: vi.fn(), setFocus: vi.fn() },
      editor: { handleInput: vi.fn() },
      chatLog: { addSystem: vi.fn(), addBranchSummary: vi.fn() },
      sendMessage: vi.fn(),
      setEditorText: vi.fn(),
      keybindings: new XopcKeybindingsManager(),
    } as never;

    await openReviewLauncherOverlay(svc);
    overlay?.handleInput?.('\x1b[B');
    overlay?.handleInput?.('\x1b[B');
    overlay?.handleInput?.('\r');
    overlay?.handleInput?.('escape');

    expect(closeOverlay).not.toHaveBeenCalled();
    expect(overlay?.render?.(100).join('\n')).toContain('Review against a base branch');
  });

  it('uses resolved keybindings in picker system hints', () => {
    const keybindings = new XopcKeybindingsManager({
      'app.model.cycleForward': 'm',
      'tui.select.up': 'u',
      'tui.select.down': 'd',
      'tui.select.confirm': 'x',
      'tui.select.cancel': 'z',
      'app.tree.foldOrUp': 'h',
      'app.tree.unfoldOrDown': 'l',
      'app.tree.editLabel': 'e',
      'app.tree.filter.cycleForward': 'f',
    });

    expect(formatModelPickerHint(keybindings)).toContain('U/D');
    expect(formatModelPickerHint(keybindings)).toContain('X select');
    expect(formatModelPickerHint(keybindings)).toContain('Z close');
    expect(formatScopedModelsOpenedHint(keybindings)).toBe('Scoped models for M');
    expect(
      formatScopedModelsSavedHint({ refs: null, total: 3, keybindings }),
    ).toBe('M cycles all 3 models');
    expect(
      formatScopedModelsSavedHint({ refs: ['p/a'], total: 3, keybindings }),
    ).toBe('M cycles 1 scoped model');
    expect(formatSettingsOpenedHint(keybindings)).toContain('X toggle');
    expect(formatSettingsOpenedHint(keybindings)).toContain('Z close');
    expect(formatSettingsOpenedHint(keybindings)).toContain('U/D');
    expect(formatSessionTreeOpenedHint(keybindings)).toContain('X resume');
    expect(formatSessionTreeOpenedHint(keybindings)).toContain('Z close');
    expect(formatSessionTreeOpenedHint(keybindings)).toContain('U/D');
    expect(formatTranscriptTreeOpenedHint(keybindings)).toContain('X inspect');
    expect(formatTranscriptTreeOpenedHint(keybindings)).toContain('Z close');
    expect(formatTranscriptTreeOpenedHint(keybindings)).toContain('U/D');
    expect(formatTranscriptTreeFilterHint(keybindings, 'user-only')).toContain('[user-only]');
    expect(formatTranscriptTreeFilterHint(keybindings, 'default')).toContain('H/L fold');
    expect(formatTranscriptTreeFilterHint(keybindings, 'default')).toContain('E label');
    expect(formatTranscriptTreeFilterHint(keybindings, 'default')).toContain('F filter');
    expect(formatTranscriptTreeFilterHint(keybindings, 'default')).toContain('filter');
    expect(formatTranscriptTreeHelpLines(keybindings, 80).join('\n')).toContain('H/L branch');
    expect(formatTranscriptTreeHelpLines(keybindings, 80).join('\n')).toContain('E label');
    expect(formatUserMessageForkOpenedHint(keybindings)).toContain('X fork');
    expect(formatUserMessageForkOpenedHint(keybindings)).toContain('Z close');
    expect(formatUserMessageForkOpenedHint(keybindings)).toContain('U/D');
    expect(formatThinkingSelectorHint(keybindings)).toContain('X select');
    expect(formatThinkingSelectorHint(keybindings)).toContain('Z close');
    expect(formatThinkingSelectorHint(keybindings)).toContain('U/D');
    expect(formatThinkingLevelSavedHint('high')).toBe('Thinking level: high');
    expect(formatReviewPickerOpenedHint(keybindings)).toContain('X select');
    expect(formatReviewPickerOpenedHint(keybindings)).toContain('Z close');
  });

  it('compacts default transcript tree help keys with arrow labels', () => {
    const rendered = formatTranscriptTreeHelpLines(new XopcKeybindingsManager(), 120).join('\n');

    expect(rendered).toContain('↑/↓ move');
    expect(rendered).toContain('←/→ page');
    expect(rendered).toContain('Ctrl+←/→ branch');
  });
});
