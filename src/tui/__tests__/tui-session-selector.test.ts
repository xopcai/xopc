import { describe, expect, it, vi } from 'vitest';

import { SessionSelector, filterSessionSelectItems } from '../components/session-selector.js';
import { XopcKeybindingsManager } from '../tui-keybindings-file.js';

describe('SessionSelector focus', () => {
  it('filters sessions by quoted phrase with whitespace normalization', () => {
    const items = [
      { value: 'a', label: 'Node', searchText: 'node\n\n   cve was discussed' },
      { value: 'b', label: 'Node other', searchText: 'node something else' },
    ];

    expect(filterSessionSelectItems(items, '"node cve"').map((item) => item.value)).toEqual(['a']);
  });

  it('filters sessions by mixed quoted phrases and fuzzy tokens', () => {
    const items = [
      {
        value: 'a',
        label: 'Production Node incident',
        searchText: 'critical\n\n   cve api patch rollout',
      },
      {
        value: 'b',
        label: 'Node incident',
        searchText: 'critical patch rollout',
      },
      {
        value: 'c',
        label: 'Production browser incident',
        searchText: 'critical cve patch rollout',
      },
    ];

    expect(filterSessionSelectItems(items, 'prod "critical cve" api').map((item) => item.value))
      .toEqual(['a']);
  });

  it('falls back to plain fuzzy tokens for unclosed quoted session searches', () => {
    const items = [
      { value: 'a', label: 'Production Node incident', searchText: 'critical cve' },
      { value: 'b', label: 'Browser incident', searchText: 'critical cve' },
    ];

    expect(filterSessionSelectItems(items, 'prod "node')).toEqual([]);
  });

  it('filters sessions by case-insensitive regex and returns no matches for invalid regex', () => {
    const items = [
      { value: 'a', label: 'Brave browser', searchText: 'stable' },
      { value: 'b', label: 'bravery', searchText: 'not exact' },
    ];

    expect(filterSessionSelectItems(items, 're:\\bbrave\\b').map((item) => item.value)).toEqual([
      'a',
    ]);
    expect(filterSessionSelectItems(items, 're:(')).toEqual([]);
  });

  it('propagates focus to search and rename inputs by mode', () => {
    const selector = new SessionSelector(
      [{ key: 's1', displayName: 'Session 1' }],
      {
        onResume: () => {},
        onRename: async () => ({ ok: true }),
        onDelete: async () => ({ ok: true }),
        onCancel: () => {},
        requestRender: () => {},
      },
    );
    const internals = selector as unknown as {
      list: { focused: boolean };
      renameInput: { focused: boolean };
    };

    selector.focused = true;
    expect(internals.list.focused).toBe(true);
    expect(internals.renameInput.focused).toBe(false);

    selector.handleInput('\x12');
    expect(internals.list.focused).toBe(false);
    expect(internals.renameInput.focused).toBe(true);

    selector.handleInput('\x1b');
    expect(internals.list.focused).toBe(true);
    expect(internals.renameInput.focused).toBe(false);
  });

  it('toggles session key details in the picker description', () => {
    const selector = new SessionSelector(
      [
        {
          key: 'agent:main:session-one',
          displayName: 'Session 1',
          messageCount: 3,
        },
      ],
      {
        onResume: () => {},
        onRename: async () => ({ ok: true }),
        onDelete: async () => ({ ok: true }),
        onCancel: () => {},
        requestRender: () => {},
      },
    );

    const initial = selector.render(120).join('\n');
    expect(initial).not.toContain('agent:main:session-one');
    expect(initial).toContain('Ctrl+P path (off)');

    selector.handleInput('\x10');
    const toggled = selector.render(120).join('\n');
    expect(toggled).toContain('agent:main:session-one');
    expect(toggled).toContain('Ctrl+P path (on)');
  });

  it('shows session cwd when path details are toggled on', () => {
    const selector = new SessionSelector(
      [
        {
          key: 'agent:main:session-one',
          displayName: 'Session 1',
          messageCount: 3,
          cwd: '/tmp/work',
        },
      ],
      {
        onResume: () => {},
        onRename: async () => ({ ok: true }),
        onDelete: async () => ({ ok: true }),
        onCancel: () => {},
        requestRender: () => {},
      },
      undefined,
      '/tmp/work',
    );

    expect(selector.render(120).join('\n')).not.toContain('/tmp/work');
    selector.handleInput('\x10');
    const toggled = selector.render(120).join('\n');
    expect(toggled).toContain('/tmp/work');
    expect(toggled).toContain('agent:main:session-one');
  });

  it('uses configured app session keybindings for actions and hints', () => {
    const keybindings = new XopcKeybindingsManager({
      'app.session.togglePath': 'x',
      'app.session.rename': 'r',
      'tui.input.tab': 't',
      'tui.select.confirm': 's',
      'tui.select.cancel': 'q',
    });
    const selector = new SessionSelector(
      [
        {
          key: 'agent:main:session-one',
          displayName: 'Session 1',
          messageCount: 3,
        },
      ],
      {
        onResume: () => {},
        onRename: async () => ({ ok: true }),
        onDelete: async () => ({ ok: true }),
        onCancel: () => {},
        requestRender: () => {},
      },
      keybindings,
    );

    expect(selector.render(160).join('\n')).toContain('X path (off)');
    expect(selector.render(160).join('\n')).toContain('T scope (current)');
    expect(selector.render(160).join('\n')).toContain('S resume');
    expect(selector.render(160).join('\n')).toContain('Q cancel');
    selector.handleInput('t');
    expect(selector.render(160).join('\n')).toContain('T scope (all)');
    selector.handleInput('x');
    const toggled = selector.render(160).join('\n');
    expect(toggled).toContain('agent:main:session-one');
    expect(toggled).toContain('X path (on)');

    selector.handleInput('r');
    const internals = selector as unknown as {
      list: { focused: boolean };
      renameInput: { focused: boolean };
    };
    selector.focused = true;
    expect(internals.renameInput.focused).toBe(true);
    expect(selector.render(160).join('\n')).toContain('S save');
    expect(selector.render(160).join('\n')).toContain('Q cancel');
  });

  it('deletes with the non-invasive session delete binding when search is empty', async () => {
    const onDelete = vi.fn(async () => ({ ok: true }));
    const keybindings = new XopcKeybindingsManager({
      'app.session.delete': 'd',
      'app.session.deleteNoninvasive': 'x',
      'tui.select.confirm': 's',
      'tui.select.cancel': 'q',
    });
    const selector = new SessionSelector(
      [{ key: 'agent:main:session-one', displayName: 'Session 1' }],
      {
        onResume: () => {},
        onRename: async () => ({ ok: true }),
        onDelete,
        onCancel: () => {},
        requestRender: () => {},
      },
      keybindings,
    );

    selector.handleInput('x');
    expect(selector.render(120).join('\n')).toContain('Delete session? S confirm · Q cancel');

    selector.handleInput('s');
    await vi.waitFor(() => expect(onDelete).toHaveBeenCalledWith('agent:main:session-one'));
  });

  it('does not enter delete confirmation for the active session', () => {
    const onDelete = vi.fn(async () => ({ ok: true }));
    const keybindings = new XopcKeybindingsManager({
      'app.session.delete': 'd',
      'app.session.deleteNoninvasive': 'x',
    });
    const selector = new SessionSelector(
      [{ key: 'agent:main:active', displayName: 'Active' }],
      {
        onResume: () => {},
        onRename: async () => ({ ok: true }),
        onDelete,
        onCancel: () => {},
        requestRender: () => {},
      },
      keybindings,
      undefined,
      'agent:main:active',
    );

    selector.handleInput('x');
    const rendered = selector.render(120).join('\n');
    expect(rendered).toContain('Cannot delete the active session');
    expect(rendered).not.toContain('Delete session?');

    selector.handleInput('x');
    expect(onDelete).not.toHaveBeenCalled();
  });

  it('passes non-invasive session delete through to search when query is non-empty', () => {
    const onDelete = vi.fn(async () => ({ ok: true }));
    const keybindings = new XopcKeybindingsManager({
      'app.session.delete': 'd',
      'app.session.deleteNoninvasive': 'x',
    });
    const selector = new SessionSelector(
      [
        { key: 'agent:main:alpha', displayName: 'Alpha' },
        { key: 'agent:main:beta', displayName: 'Beta' },
      ],
      {
        onResume: () => {},
        onRename: async () => ({ ok: true }),
        onDelete,
        onCancel: () => {},
        requestRender: () => {},
      },
      keybindings,
    );

    selector.handleInput('a');
    selector.handleInput('x');

    expect(onDelete).not.toHaveBeenCalled();
    expect(selector.render(120).join('\n')).not.toContain('Delete session?');
  });

  it('clears delete confirmation when the pending session disappears', () => {
    const onDelete = vi.fn(async () => ({ ok: true }));
    const keybindings = new XopcKeybindingsManager({
      'app.session.delete': 'd',
      'tui.select.confirm': 's',
    });
    const selector = new SessionSelector(
      [
        { key: 'agent:main:alpha', displayName: 'Alpha' },
        { key: 'agent:main:beta', displayName: 'Beta' },
      ],
      {
        onResume: () => {},
        onRename: async () => ({ ok: true }),
        onDelete,
        onCancel: () => {},
        requestRender: () => {},
      },
      keybindings,
    );

    selector.handleInput('d');
    expect(selector.render(120).join('\n')).toContain('Delete session?');

    selector.setSessions([{ key: 'agent:main:beta', displayName: 'Beta' }]);
    expect(selector.render(120).join('\n')).not.toContain('Delete session?');

    selector.handleInput('s');
    expect(onDelete).not.toHaveBeenCalled();
  });

  it('toggles between current workspace and all sessions with Tab', () => {
    const selector = new SessionSelector(
      [
        { key: 'agent:main:current', displayName: 'Current', cwd: '/tmp/work' },
        { key: 'agent:main:other', displayName: 'Other', cwd: '/tmp/other' },
        { key: 'agent:main:legacy', displayName: 'Legacy' },
      ],
      {
        onResume: () => {},
        onRename: async () => ({ ok: true }),
        onDelete: async () => ({ ok: true }),
        onCancel: () => {},
        requestRender: () => {},
      },
      undefined,
      '/tmp/work',
    );

    const current = selector.render(120).join('\n');
    expect(current).toContain('Current');
    expect(current).toContain('Legacy');
    expect(current).not.toContain('Other');
    expect(current).toContain('Tab scope (current)');

    selector.handleInput('\t');
    const all = selector.render(120).join('\n');
    expect(all).toContain('Current');
    expect(all).toContain('Other');
    expect(all).toContain('Tab scope (all)');
  });

  it('preserves the selected filtered session by value after list refresh', () => {
    let resumed = '';
    const selector = new SessionSelector(
      [
        { key: 'agent:main:alpha', displayName: 'Alpha' },
        { key: 'agent:main:bravo', displayName: 'Bravo' },
        { key: 'agent:main:bromo', displayName: 'Bromo' },
      ],
      {
        onResume: (sessionKey) => {
          resumed = sessionKey;
        },
        onRename: async () => ({ ok: true }),
        onDelete: async () => ({ ok: true }),
        onCancel: () => {},
        requestRender: () => {},
      },
    );

    selector.handleInput('b');
    selector.handleInput('r');
    expect(selector.render(120).join('\n')).toContain('Bravo');

    selector.handleInput('\x10');
    selector.handleInput('\r');

    expect(resumed).toBe('agent:main:bravo');
  });

  it('falls back to the first filtered session when the selected session disappears', () => {
    let resumed = '';
    const selector = new SessionSelector(
      [
        { key: 'agent:main:alpha', displayName: 'Alpha' },
        { key: 'agent:main:bravo', displayName: 'Bravo' },
        { key: 'agent:main:bromo', displayName: 'Bromo' },
      ],
      {
        onResume: (sessionKey) => {
          resumed = sessionKey;
        },
        onRename: async () => ({ ok: true }),
        onDelete: async () => ({ ok: true }),
        onCancel: () => {},
        requestRender: () => {},
      },
    );

    selector.handleInput('b');
    selector.handleInput('r');
    selector.setSessions([
      { key: 'agent:main:alpha', displayName: 'Alpha' },
      { key: 'agent:main:bromo', displayName: 'Bromo' },
    ]);
    selector.handleInput('\r');

    expect(resumed).toBe('agent:main:bromo');
  });

  it('applies quoted phrase search inside the rendered session picker', () => {
    const selector = new SessionSelector(
      [
        { key: 'agent:main:node-cve', displayName: 'Node   CVE' },
        { key: 'agent:main:node-other', displayName: 'Node other' },
      ],
      {
        onResume: () => {},
        onRename: async () => ({ ok: true }),
        onDelete: async () => ({ ok: true }),
        onCancel: () => {},
        requestRender: () => {},
      },
    );

    for (const ch of '"node cve"') {
      selector.handleInput(ch);
    }

    const rendered = selector.render(120).join('\n');
    expect(rendered).toContain('Node   CVE');
    expect(rendered).not.toContain('Node other');
  });
});
