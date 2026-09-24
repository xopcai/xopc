import { describe, expect, it } from 'vitest';

import {
  BUILTIN_NAV_DEFS,
  builtinNavDefsForFeatures,
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
  it('only offers scenes after the rollout flag is enabled', () => {
    expect(builtinNavDefsForFeatures(false).some((item) => item.id === 'builtin:scenes')).toBe(false);
    expect(builtinNavDefsForFeatures(true).some((item) => item.id === 'builtin:scenes')).toBe(true);
  });
  it('offers the app workshop as a built-in navigation destination', () => {
    expect(BUILTIN_NAV_DEFS).toContainEqual(expect.objectContaining({
      id: 'builtin:localApps',
      to: '/local-apps',
    }));
  });

  it('keeps the intended product destinations primary and assistant arrangements under More', () => {
    expect(PRIMARY_NAV_IDS).toEqual([
      'builtin:home',
      'builtin:capabilities',
      'builtin:automations',
      'builtin:projects',
      'builtin:notes',
    ]);
    expect(BUILTIN_NAV_DEFS.slice(0, DEFAULT_VISIBLE_NAV_ITEMS)).toEqual([
      expect.objectContaining({ id: 'builtin:home', to: '/' }),
      expect.objectContaining({ id: 'builtin:capabilities', to: '/capabilities/discover' }),
      expect.objectContaining({ id: 'builtin:automations', to: '/automations' }),
      expect.objectContaining({ id: 'builtin:projects', to: '/projects' }),
      expect.objectContaining({ id: 'builtin:notes', to: '/notes' }),
    ]);
    expect(BUILTIN_NAV_DEFS.at(-1)).toEqual(expect.objectContaining({ id: 'builtin:scenes', to: '/scenes' }));
  });

  it('keeps the intended default built-in navigation order', () => {
    expect(BUILTIN_NAV_DEFS.map((item) => item.id)).toEqual([
      'builtin:home',
      'builtin:capabilities',
      'builtin:automations',
      'builtin:projects',
      'builtin:notes',
      'builtin:workflows',
      'builtin:browserAutomations',
      'builtin:localApps',
      'builtin:scenes',
    ]);
  });

  it('keeps agent and channel management inside the capability center', () => {
    expect(BUILTIN_NAV_DEFS.map((item) => item.id)).not.toContain('builtin:agents');
    expect(BUILTIN_NAV_DEFS.map((item) => item.id)).not.toContain('builtin:channels');
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

  it('keeps Workbench, Capabilities, Automations, Projects, and Notes visible by default', () => {
    const available = [
      item('builtin:home'),
      item('builtin:capabilities'),
      item('builtin:automations'),
      item('builtin:projects'),
      item('builtin:notes'),
      item('builtin:scenes'),
    ];
    const out = reconcileNavOrder(available, []);
    expect(out.visible.map((i) => i.id)).toEqual([
      'builtin:home',
      'builtin:capabilities',
      'builtin:automations',
      'builtin:projects',
      'builtin:notes',
    ]);
    expect(out.overflow.map((i) => i.id)).toEqual(['builtin:scenes']);
  });

  it('appends new items that are not yet in the stored order', () => {
    const available = [
      item('builtin:workflows'),
      item('builtin:capabilities'),
      item('builtin:automations'),
      item('builtin:browserAutomations'),
      item('ext:foo:home'),
      item('ext:bar:home'),
    ];
    const stored = ['builtin:capabilities', 'builtin:workflows'];
    const out = reconcileNavOrder(available, stored);
    expect(out.hasOverflow).toBe(true);
    expect(out.visible.map((i) => i.id)).toEqual([
      'builtin:capabilities',
      'builtin:workflows',
      'builtin:automations',
      'builtin:browserAutomations',
      'ext:foo:home',
    ]);
    expect(out.overflow.map((i) => i.id)).toEqual(['ext:bar:home']);
  });

  it('filters out stored ids that are no longer available', () => {
    const available = [item('builtin:workflows'), item('builtin:automations')];
    const stored = ['ext:gone:page', 'builtin:automations', 'builtin:workflows'];
    const out = reconcileNavOrder(available, stored);
    expect(out.visible.map((i) => i.id)).toEqual(['builtin:automations', 'builtin:workflows']);
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
      item('builtin:home'),
      item('builtin:capabilities'),
      item('builtin:automations'),
      item('builtin:projects'),
      item('builtin:notes'),
      item('builtin:workflows'),
    ];
    const out = reconcileNavOrder(available, []);
    expect(out.hasOverflow).toBe(true);
    expect(out.visible).toHaveLength(DEFAULT_VISIBLE_NAV_ITEMS);
    expect(out.overflow.map((i) => i.id)).toEqual(['builtin:workflows']);
  });

  it('overflows past the default with first N shown and the rest hidden', () => {
    const available = [
      item('builtin:home'),
      item('builtin:capabilities'),
      item('builtin:automations'),
      item('builtin:projects'),
      item('ext:foo:a'),
      item('ext:bar:b'),
      item('ext:baz:c'),
    ];
    const out = reconcileNavOrder(available, []);
    expect(out.hasOverflow).toBe(true);
    expect(out.visible).toHaveLength(DEFAULT_VISIBLE_NAV_ITEMS);
    expect(out.visible.map((i) => i.id)).toEqual([
      'builtin:home',
      'builtin:capabilities',
      'builtin:automations',
      'builtin:projects',
      'ext:foo:a',
    ]);
    expect(out.overflow.map((i) => i.id)).toEqual([
      'ext:bar:b',
      'ext:baz:c',
    ]);
  });

  it('supports resizing the visible rail between two and five destinations', () => {
    const available = Array.from({ length: 6 }, (_, i) => item(`builtin:${i}`));
    const min = reconcileNavOrder(available, [], MIN_VISIBLE_NAV_ITEMS);
    const max = reconcileNavOrder(available, [], MAX_VISIBLE_NAV_ITEMS);

    expect(min.visible).toHaveLength(2);
    expect(max.visible).toHaveLength(5);
    expect(max.overflow).toHaveLength(1);
  });

  it('drops duplicate ids in stored order', () => {
    const available = [item('builtin:workflows'), item('builtin:capabilities')];
    const stored = ['builtin:workflows', 'builtin:workflows', 'builtin:capabilities'];
    const out = reconcileNavOrder(available, stored);
    expect(out.visible.map((i) => i.id)).toEqual(['builtin:workflows', 'builtin:capabilities']);
  });
});
