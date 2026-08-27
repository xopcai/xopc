import { describe, expect, it } from 'vitest';

import {
  BUILTIN_NAV_DEFS,
  DEFAULT_VISIBLE_NAV_ITEMS,
  MAX_VISIBLE_NAV_ITEMS,
  MIN_VISIBLE_NAV_ITEMS,
  PRIMARY_NAV_IDS,
  reconcileNavOrder,
  type NavItem,
} from '@/navigation/sidebar-nav-items';

function item(id: string): NavItem {
  return { id, kind: id.startsWith('ext:') ? 'extension' : 'builtin', label: id, to: `/${id}`, Icon: undefined };
}

describe('reconcileNavOrder', () => {
  it('offers the app workshop as a built-in navigation destination', () => {
    expect(BUILTIN_NAV_DEFS).toContainEqual(expect.objectContaining({
      id: 'builtin:localApps',
      to: '/local-apps',
    }));
  });

  it('places the workbench, projects, and notes before advanced capabilities', () => {
    expect(PRIMARY_NAV_IDS).toEqual([
      'builtin:home',
      'builtin:projects',
      'builtin:notes',
    ]);
    expect(BUILTIN_NAV_DEFS.slice(0, DEFAULT_VISIBLE_NAV_ITEMS)).toEqual([
      expect.objectContaining({ id: 'builtin:home', to: '/' }),
      expect.objectContaining({ id: 'builtin:projects', to: '/projects' }),
      expect.objectContaining({ id: 'builtin:notes', to: '/notes' }),
    ]);
  });

  it('keeps the intended default built-in navigation order', () => {
    expect(BUILTIN_NAV_DEFS.map((item) => item.id)).toEqual([
      'builtin:home',
      'builtin:projects',
      'builtin:notes',
      'builtin:automations',
      'builtin:skills',
      'builtin:connectors',
      'builtin:agents',
      'builtin:channels',
      'builtin:workflows',
      'builtin:browserWorkflows',
      'builtin:localApps',
      'builtin:extensions',
    ]);
  });

  it('preserves the available order when nothing is stored', () => {
    const available = [item('builtin:home'), item('builtin:notes')];
    const out = reconcileNavOrder(available, []);
    expect(out.hasOverflow).toBe(false);
    expect(out.visible.map((i) => i.id)).toEqual([
      'builtin:home',
      'builtin:notes',
    ]);
    expect(out.overflow).toEqual([]);
  });

  it('honors stored customization for draggable product destinations', () => {
    const available = [item('builtin:home'), item('builtin:notes')];
    const stored = ['builtin:notes', 'builtin:home'];
    const out = reconcileNavOrder(available, stored);
    expect(out.visible.map((i) => i.id)).toEqual(['builtin:notes', 'builtin:home']);
  });

  it('keeps Workbench, Projects, and Notes visible by default', () => {
    const available = [
      item('builtin:home'),
      item('builtin:projects'),
      item('builtin:notes'),
      item('builtin:automations'),
    ];
    const out = reconcileNavOrder(available, []);
    expect(out.visible.map((i) => i.id)).toEqual(['builtin:home', 'builtin:projects', 'builtin:notes']);
    expect(out.overflow.map((i) => i.id)).toEqual(['builtin:automations']);
  });

  it('appends new items that are not yet in the stored order', () => {
    const available = [
      item('builtin:agents'),
      item('builtin:skills'),
      item('builtin:automations'),
      item('builtin:channels'),
      item('ext:foo:home'),
    ];
    const stored = ['builtin:skills', 'builtin:agents'];
    const out = reconcileNavOrder(available, stored);
    expect(out.hasOverflow).toBe(true);
    expect(out.visible.map((i) => i.id)).toEqual([
      'builtin:skills',
      'builtin:agents',
      'builtin:automations',
    ]);
    expect(out.overflow.map((i) => i.id)).toEqual([
      'builtin:channels',
      'ext:foo:home',
    ]);
  });

  it('filters out stored ids that are no longer available', () => {
    const available = [item('builtin:agents'), item('builtin:automations')];
    const stored = ['ext:gone:page', 'builtin:automations', 'builtin:agents'];
    const out = reconcileNavOrder(available, stored);
    expect(out.visible.map((i) => i.id)).toEqual(['builtin:automations', 'builtin:agents']);
  });

  it('keeps every item visible when count equals the default', () => {
    const available = Array.from({ length: DEFAULT_VISIBLE_NAV_ITEMS }, (_, i) => item(`builtin:${i}`));
    const out = reconcileNavOrder(available, []);
    expect(out.hasOverflow).toBe(false);
    expect(out.visible).toHaveLength(DEFAULT_VISIBLE_NAV_ITEMS);
    expect(out.overflow).toEqual([]);
  });

  it('overflows built-in items when count exceeds the default', () => {
    const available = [
      item('builtin:agents'),
      item('builtin:skills'),
      item('builtin:automations'),
      item('builtin:channels'),
      item('builtin:notes'),
      item('builtin:workflows'),
    ];
    const out = reconcileNavOrder(available, []);
    expect(out.hasOverflow).toBe(true);
    expect(out.visible).toHaveLength(DEFAULT_VISIBLE_NAV_ITEMS);
    expect(out.overflow.map((i) => i.id)).toEqual([
      'builtin:channels',
      'builtin:notes',
      'builtin:workflows',
    ]);
  });

  it('overflows past the default with first N shown and the rest hidden', () => {
    const available = [
      item('builtin:agents'),
      item('builtin:skills'),
      item('builtin:automations'),
      item('builtin:channels'),
      item('ext:foo:a'),
      item('ext:bar:b'),
      item('ext:baz:c'),
    ];
    const out = reconcileNavOrder(available, []);
    expect(out.hasOverflow).toBe(true);
    expect(out.visible).toHaveLength(DEFAULT_VISIBLE_NAV_ITEMS);
    expect(out.visible.map((i) => i.id)).toEqual([
      'builtin:agents',
      'builtin:skills',
      'builtin:automations',
    ]);
    expect(out.overflow.map((i) => i.id)).toEqual([
      'builtin:channels',
      'ext:foo:a',
      'ext:bar:b',
      'ext:baz:c',
    ]);
  });

  it('supports resizing the visible rail between two and four destinations', () => {
    const available = Array.from({ length: 6 }, (_, i) => item(`builtin:${i}`));
    const min = reconcileNavOrder(available, [], MIN_VISIBLE_NAV_ITEMS);
    const max = reconcileNavOrder(available, [], MAX_VISIBLE_NAV_ITEMS);

    expect(min.visible).toHaveLength(2);
    expect(max.visible).toHaveLength(4);
    expect(max.overflow).toHaveLength(2);
  });

  it('drops duplicate ids in stored order', () => {
    const available = [item('builtin:agents'), item('builtin:skills')];
    const stored = ['builtin:agents', 'builtin:agents', 'builtin:skills'];
    const out = reconcileNavOrder(available, stored);
    expect(out.visible.map((i) => i.id)).toEqual(['builtin:agents', 'builtin:skills']);
  });
});
