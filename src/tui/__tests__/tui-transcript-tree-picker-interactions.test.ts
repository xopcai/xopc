import { describe, expect, it } from 'vitest';

import { XopcKeybindingsManager } from '../tui-keybindings-file.js';
import { TranscriptTreeSelectList } from '../tui-picker-overlay.js';
import { buildTuiTranscriptTree } from '../tui-transcript-tree.js';

describe('tui transcript tree picker interactions', () => {
it('cycles transcript tree filters inside the picker', () => {
    const keybindings = new XopcKeybindingsManager({
      'app.tree.filter.cycleForward': 'f',
      'app.tree.filter.cycleBackward': 'b',
      'app.tree.filter.labeledOnly': 'l',
      'app.tree.filter.all': 'a',
    });
    const list = new TranscriptTreeSelectList(
      [
        {
          id: 'row-1',
          depth: 0,
          label: 'user',
          role: 'user',
          userLabel: 'important',
          turn: 1,
          preview: 'Plan this change',
        },
        {
          id: 'row-2',
          parentId: 'row-1',
          depth: 1,
          label: 'assistant',
          role: 'assistant',
          turn: 1,
          preview: 'Implementation details',
        },
        {
          id: 'row-3',
          parentId: 'row-1',
          depth: 1,
          label: 'context',
          turn: 1,
          preview: 'audit',
        },
      ],
      'default',
      keybindings,
      10,
    );
    const seen: string[] = [];
    list.onFilterChange = (mode) => seen.push(mode);

    expect(list.getFilterMode()).toBe('default');
    expect(list.render(80).join('\n')).toContain('assistant');

    list.handleInput('l');
    expect(list.getFilterMode()).toBe('labeled-only');
    expect(list.getSelectedItem()?.value).toBe('row-1');
    expect(list.render(80).join('\n')).not.toContain('assistant');

    list.handleInput('l');
    expect(list.getFilterMode()).toBe('default');

    list.handleInput('f');
    expect(list.getFilterMode()).toBe('no-tools');

    list.handleInput('b');
    expect(list.getFilterMode()).toBe('default');

    list.handleInput('a');
    expect(list.getFilterMode()).toBe('all');
    expect(list.render(80).join('\n')).toContain('context');
    expect(seen).toEqual(['labeled-only', 'default', 'no-tools', 'default', 'all']);
  });

  it('shows transcript tree selection position in the status line', () => {
    const list = new TranscriptTreeSelectList(
      [
        {
          id: 'row-1',
          depth: 0,
          label: 'user',
          role: 'user',
          turn: 1,
          preview: 'Plan this change',
        },
        {
          id: 'row-2',
          parentId: 'row-1',
          depth: 1,
          label: 'assistant',
          role: 'assistant',
          turn: 1,
          preview: 'Implementation details',
        },
      ],
      'default',
      new XopcKeybindingsManager(),
      10,
    );

    expect(list.render(80)[0]).toContain('(1/2)');
    expect(list.render(80)[1]).toContain('Type to search:');
    list.handleInput('\x1b[B');
    expect(list.render(80)[0]).toContain('(2/2)');
    list.handleInput('nomatch');
    expect(list.render(80)[0]).toContain('(0/0)');
    expect(list.render(80).join('\n')).toContain('No entries found');
    expect(list.render(80).join('\n')).not.toContain('No matches');
  });

  it('shows pi-style transcript tree status labels for filters and label timestamps', () => {
    const keybindings = new XopcKeybindingsManager({
      'app.tree.filter.noTools': 'n',
      'app.tree.filter.userOnly': 'u',
      'app.tree.filter.labeledOnly': 'l',
      'app.tree.filter.all': 'a',
      'app.tree.toggleLabelTimestamp': 't',
    });
    const list = new TranscriptTreeSelectList(
      [
        {
          id: 'row-1',
          depth: 0,
          label: 'user',
          role: 'user',
          userLabel: 'important',
          labelTimestamp: '2026-06-17T10:05:00.000Z',
          turn: 1,
          preview: 'Plan this change',
        },
      ],
      'default',
      keybindings,
      10,
    );

    expect(list.render(80)[0]).toContain('(1/1)');
    expect(list.render(80)[0]).not.toContain('[no-tools]');

    list.handleInput('n');
    expect(list.render(80)[0]).toContain('(1/1) [no-tools]');

    list.handleInput('u');
    expect(list.render(80)[0]).toContain('(1/1) [user]');

    list.handleInput('l');
    expect(list.render(80)[0]).toContain('(1/1) [labeled]');

    list.handleInput('a');
    expect(list.render(80)[0]).toContain('(1/1) [all]');

    list.handleInput('t');
    expect(list.render(80)[0]).toContain('(1/1) [all] [+label time]');
  });

  it('renders transcript tree key help inside the picker', () => {
    const keybindings = new XopcKeybindingsManager({
      'tui.select.up': 'u',
      'tui.select.down': 'd',
      'tui.editor.cursorLeft': 'p',
      'tui.editor.cursorRight': 'n',
      'app.tree.foldOrUp': 'h',
      'app.tree.unfoldOrDown': 'l',
      'app.tree.editLabel': 'e',
      'app.tree.toggleLabelTimestamp': 't',
      'app.tree.filter.cycleForward': 'f',
      'app.tree.filter.cycleBackward': 'b',
    });
    const list = new TranscriptTreeSelectList(
      [
        {
          id: 'row-1',
          depth: 0,
          label: 'user',
          role: 'user',
          turn: 1,
          preview: 'Plan this change',
        },
      ],
      'default',
      keybindings,
      10,
    );

    const rendered = list.render(80).join('\n');
    expect(rendered).toContain('U/D move');
    expect(rendered).toContain('P/N page');
    expect(rendered).toContain('H/L branch');
    expect(rendered).toContain('E label');
    expect(rendered).toContain('T label time');
    expect(rendered).toContain('cycle F/B');
  });

  it('preserves transcript tree selection when refreshing item labels', () => {
    const keybindings = new XopcKeybindingsManager({
      'app.tree.toggleLabelTimestamp': 't',
    });
    const list = new TranscriptTreeSelectList(
      [
        {
          id: 'row-1',
          depth: 0,
          label: 'user',
          role: 'user',
          userLabel: 'important',
          labelTimestamp: '2026-06-17T10:05:00.000Z',
          turn: 1,
          preview: 'Plan this change',
        },
        {
          id: 'row-2',
          parentId: 'row-1',
          depth: 1,
          label: 'assistant',
          role: 'assistant',
          turn: 1,
          preview: 'Implementation details',
        },
      ],
      'default',
      keybindings,
      10,
    );

    list.handleInput('\x1b[B');
    expect(list.getSelectedItem()?.value).toBe('row-2');

    list.handleInput('t');

    expect(list.getSelectedItem()?.value).toBe('row-2');
  });

  it('opens transcript tree selection on the current leaf', () => {
    const list = new TranscriptTreeSelectList(
      [
        {
          id: 'row-1',
          depth: 0,
          label: 'user',
          role: 'user',
          isOnActivePath: true,
          turn: 1,
          preview: 'Plan this change',
        },
        {
          id: 'row-2',
          parentId: 'row-1',
          depth: 1,
          label: 'assistant',
          role: 'assistant',
          isOnActivePath: true,
          isCurrentLeaf: true,
          turn: 1,
          preview: 'Implementation details',
        },
      ],
      'default',
      new XopcKeybindingsManager({}),
      10,
    );

    expect(list.getSelectedItem()?.value).toBe('row-2');
    expect(list.render(80).join('\n')).toContain('(2/2)');
  });

  it('opens transcript tree selection on the nearest visible current-leaf ancestor', () => {
    const list = new TranscriptTreeSelectList(
      [
        {
          id: 'row-1',
          depth: 0,
          label: 'user',
          role: 'user',
          isOnActivePath: true,
          turn: 1,
          preview: 'Plan this change',
        },
        {
          id: 'row-2',
          parentId: 'row-1',
          depth: 1,
          label: 'assistant',
          role: 'assistant',
          isOnActivePath: true,
          isCurrentLeaf: true,
          turn: 1,
          preview: 'Implementation details',
        },
      ],
      'user-only',
      new XopcKeybindingsManager({}),
      10,
    );

    expect(list.getSelectedItem()?.value).toBe('row-1');
    expect(list.render(80).join('\n')).toContain('(1/1) [user]');
  });

  it('opens transcript tree on an otherwise hidden current assistant leaf', () => {
    const list = new TranscriptTreeSelectList(
      buildTuiTranscriptTree([
        { role: 'user', content: 'Plan this change' },
        {
          role: 'assistant',
          content: [{ type: 'toolCall', id: 't1', name: 'read', arguments: { path: 'src/a.ts' } }],
        },
      ] as never),
      'default',
      new XopcKeybindingsManager({}),
      10,
    );

    expect(list.getSelectedItem()?.value).toBe('row-2');
    expect(list.render(80).join('\n')).toContain('→   └─ • #1 assistant: [read: src/a.ts]');
  });

  it('selects the nearest visible transcript ancestor when filtering hides the selected row', () => {
    const keybindings = new XopcKeybindingsManager({
      'app.tree.filter.labeledOnly': 'l',
    });
    const list = new TranscriptTreeSelectList(
      [
        {
          id: 'row-1',
          depth: 0,
          label: 'user',
          role: 'user',
          userLabel: 'important',
          turn: 1,
          preview: 'Plan this change',
        },
        {
          id: 'row-2',
          parentId: 'row-1',
          depth: 1,
          label: 'assistant',
          role: 'assistant',
          turn: 1,
          preview: 'Implementation details',
        },
      ],
      'default',
      keybindings,
      10,
    );

    list.handleInput('\x1b[B');
    expect(list.getSelectedItem()?.value).toBe('row-2');

    list.handleInput('l');

    expect(list.getSelectedItem()?.value).toBe('row-1');
  });

  it('folds and unfolds transcript tree branches inside the picker', () => {
    const keybindings = new XopcKeybindingsManager({
      'app.tree.foldOrUp': 'h',
      'app.tree.unfoldOrDown': 'l',
    });
    const list = new TranscriptTreeSelectList(
      [
        {
          id: 'row-1',
          depth: 0,
          label: 'user',
          role: 'user',
          turn: 1,
          preview: 'Plan this change',
        },
        {
          id: 'row-2',
          parentId: 'row-1',
          depth: 1,
          label: 'assistant',
          role: 'assistant',
          turn: 1,
          preview: 'Implementation details',
        },
      ],
      'default',
      keybindings,
      10,
    );

    expect(list.render(80).join('\n')).toContain('assistant');
    expect(list.render(80).join('\n')).toContain('⊟ - #1 user: Plan this change');

    list.handleInput('h');
    const folded = list.render(80).join('\n');
    expect(folded).toContain('⊞ - #1 user: Plan this change');
    expect(folded).not.toContain('assistant');
    expect(list.getSelectedItem()?.value).toBe('row-1');

    list.handleInput('l');
    const unfolded = list.render(80).join('\n');
    expect(unfolded).not.toContain('⊞ - #1 user: Plan this change');
    expect(unfolded).toContain('assistant');
  });

  it('clears folded transcript tree branches when changing filters', () => {
    const keybindings = new XopcKeybindingsManager({
      'app.tree.foldOrUp': 'h',
      'app.tree.filter.all': 'a',
    });
    const list = new TranscriptTreeSelectList(
      [
        {
          id: 'row-1',
          depth: 0,
          label: 'user',
          role: 'user',
          turn: 1,
          preview: 'Plan this change',
        },
        {
          id: 'row-2',
          parentId: 'row-1',
          depth: 1,
          label: 'context',
          turn: 1,
          preview: 'audit',
        },
      ],
      'default',
      keybindings,
      10,
    );

    list.handleInput('h');
    expect(list.render(80).join('\n')).not.toContain('context');

    list.handleInput('a');

    expect(list.getFilterMode()).toBe('all');
    expect(list.render(80).join('\n')).toContain('context');
  });

  it('clears folded transcript tree branches when search changes', () => {
    const keybindings = new XopcKeybindingsManager({
      'app.tree.foldOrUp': 'h',
    });
    const list = new TranscriptTreeSelectList(
      [
        {
          id: 'row-1',
          depth: 0,
          label: 'user',
          role: 'user',
          turn: 1,
          preview: 'Plan this change',
        },
        {
          id: 'row-2',
          parentId: 'row-1',
          depth: 1,
          label: 'assistant',
          role: 'assistant',
          turn: 1,
          preview: 'Implementation details',
        },
      ],
      'default',
      keybindings,
      10,
    );

    list.handleInput('h');
    expect(list.render(80).join('\n')).not.toContain('assistant');

    for (const ch of 'assistant') {
      list.handleInput(ch);
    }

    expect(list.render(80).join('\n')).toContain('assistant');
  });

  it('preserves transcript tree selection when search still matches it', () => {
    const list = new TranscriptTreeSelectList(
      [
        {
          id: 'row-1',
          depth: 0,
          label: 'user',
          role: 'user',
          turn: 1,
          preview: 'Plan alpha',
        },
        {
          id: 'row-2',
          depth: 0,
          label: 'user',
          role: 'user',
          turn: 2,
          preview: 'Plan beta',
        },
      ],
      'default',
      new XopcKeybindingsManager({}),
      10,
    );

    list.handleInput('\x1b[B');
    expect(list.getSelectedItem()?.value).toBe('row-2');

    for (const ch of 'plan') {
      list.handleInput(ch);
    }

    expect(list.getSelectedItem()?.value).toBe('row-2');
    expect(list.render(80).join('\n')).toContain('(2/2)');
  });

  it('moves transcript tree selection to the first search match when previous selection no longer matches', () => {
    const list = new TranscriptTreeSelectList(
      [
        {
          id: 'row-1',
          depth: 0,
          label: 'user',
          role: 'user',
          turn: 1,
          preview: 'Alpha plan',
        },
        {
          id: 'row-2',
          depth: 0,
          label: 'user',
          role: 'user',
          turn: 2,
          preview: 'Beta plan',
        },
      ],
      'default',
      new XopcKeybindingsManager({}),
      10,
    );

    list.handleInput('\x1b[B');
    expect(list.getSelectedItem()?.value).toBe('row-2');

    for (const ch of 'alpha') {
      list.handleInput(ch);
    }

    expect(list.getSelectedItem()?.value).toBe('row-1');
    expect(list.render(80).join('\n')).toContain('(1/1)');
  });

  it('filters transcript tree search with pi-style all-token matching', () => {
    const list = new TranscriptTreeSelectList(
      [
        {
          id: 'row-1',
          depth: 0,
          label: 'user',
          role: 'user',
          turn: 1,
          preview: 'Alpha migration plan',
        },
        {
          id: 'row-2',
          depth: 0,
          label: 'user',
          role: 'user',
          turn: 2,
          preview: 'Alpha cleanup notes',
        },
        {
          id: 'row-3',
          depth: 0,
          label: 'user',
          role: 'user',
          turn: 3,
          preview: 'Migration beta notes',
        },
      ],
      'default',
      new XopcKeybindingsManager({}),
      10,
    );

    for (const ch of 'alpha migration') {
      list.handleInput(ch);
    }

    const rendered = list.render(100).join('\n');
    expect(list.getSelectedItem()?.value).toBe('row-1');
    expect(rendered).toContain('Alpha migration plan');
    expect(rendered).not.toContain('Alpha cleanup notes');
    expect(rendered).not.toContain('Migration beta notes');
    expect(rendered).toContain('(1/1)');
  });

  it('uses transcript tree fold keys to jump between branch segments', () => {
    const keybindings = new XopcKeybindingsManager({
      'app.tree.foldOrUp': 'h',
      'app.tree.unfoldOrDown': 'l',
    });
    const list = new TranscriptTreeSelectList(
      [
        {
          id: 'root',
          depth: 0,
          label: 'user',
          role: 'user',
          turn: 1,
          preview: 'Root prompt',
        },
        {
          id: 'linear',
          parentId: 'root',
          depth: 1,
          label: 'assistant',
          role: 'assistant',
          turn: 1,
          preview: 'Linear answer',
        },
        {
          id: 'branch-a',
          parentId: 'linear',
          depth: 1,
          label: 'user',
          role: 'user',
          turn: 2,
          preview: 'Branch A',
        },
        {
          id: 'branch-a-child',
          parentId: 'branch-a',
          depth: 2,
          label: 'assistant',
          role: 'assistant',
          turn: 2,
          preview: 'Branch A answer',
        },
        {
          id: 'branch-b',
          parentId: 'linear',
          depth: 1,
          label: 'user',
          role: 'user',
          turn: 2,
          preview: 'Branch B',
        },
      ],
      'default',
      keybindings,
      10,
    );

    list.handleInput('l');
    expect(list.getSelectedItem()?.value).toBe('branch-a');

    list.handleInput('\x1b[B');
    expect(list.getSelectedItem()?.value).toBe('branch-a-child');

    list.handleInput('h');
    expect(list.getSelectedItem()?.value).toBe('branch-a');
  });

  it('pages transcript tree selection with editor and select page bindings', () => {
    const keybindings = new XopcKeybindingsManager({
      'tui.editor.cursorLeft': 'h',
      'tui.editor.cursorRight': 'l',
      'tui.select.pageUp': 'u',
      'tui.select.pageDown': 'd',
    });
    const list = new TranscriptTreeSelectList(
      Array.from({ length: 8 }, (_, index) => ({
        id: `row-${index}`,
        depth: 0,
        label: `row-${index}`,
        role: index % 2 === 0 ? 'user' : 'assistant',
        turn: index + 1,
        preview: `Entry ${index}`,
      })),
      'default',
      keybindings,
      3,
    );

    list.handleInput('l');
    expect(list.getSelectedItem()?.value).toBe('row-3');

    list.handleInput('l');
    expect(list.getSelectedItem()?.value).toBe('row-6');

    list.handleInput('l');
    expect(list.getSelectedItem()?.value).toBe('row-7');

    list.handleInput('h');
    expect(list.getSelectedItem()?.value).toBe('row-4');

    list.handleInput('u');
    expect(list.getSelectedItem()?.value).toBe('row-1');

    list.handleInput('d');
    expect(list.getSelectedItem()?.value).toBe('row-4');
  });

  it('clears transcript tree search with cancel before closing the picker', () => {
    const keybindings = new XopcKeybindingsManager({
      'tui.select.cancel': 'q',
    });
    const list = new TranscriptTreeSelectList(
      [
        {
          id: 'row-1',
          depth: 0,
          label: 'user',
          role: 'user',
          turn: 1,
          preview: 'Plan this change',
        },
        {
          id: 'row-2',
          parentId: 'row-1',
          depth: 1,
          label: 'assistant',
          role: 'assistant',
          turn: 1,
          preview: 'Implementation details',
        },
      ],
      'default',
      keybindings,
      10,
    );
    let cancelled = 0;
    list.onCancel = () => {
      cancelled += 1;
    };

    for (const ch of 'assistant') {
      list.handleInput(ch);
    }
    expect(list.render(80).join('\n')).not.toContain('Plan this change');

    list.handleInput('q');
    expect(cancelled).toBe(0);
    expect(list.render(80).join('\n')).toContain('Plan this change');

    list.handleInput('q');
    expect(cancelled).toBe(1);
  });

  it('restores the last transcript tree selection when clearing an empty search result', () => {
    const keybindings = new XopcKeybindingsManager({
      'tui.select.cancel': 'q',
    });
    const list = new TranscriptTreeSelectList(
      [
        {
          id: 'row-1',
          depth: 0,
          label: 'user',
          role: 'user',
          turn: 1,
          preview: 'Alpha plan',
        },
        {
          id: 'row-2',
          depth: 0,
          label: 'user',
          role: 'user',
          turn: 2,
          preview: 'Beta plan',
        },
      ],
      'default',
      keybindings,
      10,
    );

    list.handleInput('\x1b[B');
    expect(list.getSelectedItem()?.value).toBe('row-2');

    for (const ch of 'nomatch') {
      list.handleInput(ch);
    }
    expect(list.getSelectedItem()).toBeNull();

    list.handleInput('q');

    expect(list.getSelectedItem()?.value).toBe('row-2');
    expect(list.render(80).join('\n')).toContain('(2/2)');
  });

  it('edits transcript tree labels inside the picker', () => {
    const keybindings = new XopcKeybindingsManager({
      'app.tree.editLabel': 'e',
      'tui.select.confirm': 's',
      'tui.select.cancel': 'c',
    });
    const list = new TranscriptTreeSelectList(
      [
        {
          id: 'row-1',
          depth: 0,
          label: 'user',
          role: 'user',
          turn: 1,
          preview: 'Plan this change',
        },
      ],
      'default',
      keybindings,
      10,
    );
    const saved: Array<{ id: string; label: string | undefined }> = [];
    list.onLabelSubmit = (entry, label) => {
      saved.push({ id: entry.id, label });
      list.updateEntryLabel(entry.id, label);
    };

    list.handleInput('e');
    expect(list.render(80).join('\n')).toContain('empty to clear');
    list.handleInput('important');
    list.handleInput('s');

    expect(saved).toEqual([{ id: 'row-1', label: 'important' }]);
    expect(list.getSelectedItem()?.label).toContain('[important] user');

    list.handleInput('e');
    list.handleInput('c');
    expect(saved).toHaveLength(1);
  });

  it('toggles transcript tree label timestamps inside the picker', () => {
    const keybindings = new XopcKeybindingsManager({
      'app.tree.toggleLabelTimestamp': 't',
    });
    const labelDate = new Date();
    labelDate.setHours(10, 5, 0, 0);
    const list = new TranscriptTreeSelectList(
      [
        {
          id: 'row-1',
          depth: 0,
          label: 'user',
          role: 'user',
          userLabel: 'important',
          labelTimestamp: labelDate.toISOString(),
          turn: 1,
          preview: 'Plan this change',
        },
      ],
      'default',
      keybindings,
      10,
    );

    expect(list.render(80).join('\n')).toContain('[important] user');
    expect(list.render(80).join('\n')).not.toContain('10:05');

    list.handleInput('t');

    const rendered = list.render(80).join('\n');
    expect(rendered).toContain('label time');
    expect(rendered).toMatch(/\[important\] \d{2}:\d{2} user/);
  });
});
