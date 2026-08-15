import { describe, expect, it } from 'vitest';

import {
  BUILTIN_NAV_DEFS,
  MAX_VISIBLE_NAV_ITEMS,
  MIN_VISIBLE_NAV_ITEMS,
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

  it('places work before the user profile and projects', () => {
    expect(BUILTIN_NAV_DEFS.slice(0, 3)).toEqual([
      expect.objectContaining({ id: 'builtin:work', to: '/work' }),
      expect.objectContaining({ id: 'builtin:profile', to: '/you' }),
      expect.objectContaining({ id: 'builtin:projects', to: '/projects' }),
    ]);
  });

  it('keeps the intended default built-in navigation order', () => {
    expect(BUILTIN_NAV_DEFS.map((item) => item.id)).toEqual([
      'builtin:work',
      'builtin:profile',
      'builtin:projects',
      'builtin:automations',
      'builtin:skills',
      'builtin:connectors',
      'builtin:agents',
      'builtin:notes',
      'builtin:channels',
      'builtin:goals',
      'builtin:workflows',
      'builtin:browserWorkflows',
      'builtin:localApps',
      'builtin:extensions',
    ]);
  });

  it('preserves the available order when nothing is stored', () => {
    const available = [item('builtin:work'), item('builtin:profile')];
    const out = reconcileNavOrder(available, []);
    expect(out.hasOverflow).toBe(false);
    expect(out.visible.map((i) => i.id)).toEqual([
      'builtin:work',
      'builtin:profile',
    ]);
    expect(out.overflow).toEqual([]);
  });

  it('keeps primary product destinations ahead of stored customization', () => {
    const available = [item('builtin:work'), item('builtin:profile')];
    const stored = ['builtin:profile', 'builtin:work'];
    const out = reconcileNavOrder(available, stored);
    expect(out.visible.map((i) => i.id)).toEqual(['builtin:work', 'builtin:profile']);
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

  it('keeps every item visible when count equals the cap', () => {
    const available = Array.from({ length: MIN_VISIBLE_NAV_ITEMS }, (_, i) => item(`builtin:${i}`));
    const out = reconcileNavOrder(available, []);
    expect(out.hasOverflow).toBe(false);
    expect(out.visible).toHaveLength(MIN_VISIBLE_NAV_ITEMS);
    expect(out.overflow).toEqual([]);
  });

  it('overflows built-in items when count exceeds the cap', () => {
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
    expect(out.visible).toHaveLength(MIN_VISIBLE_NAV_ITEMS);
    expect(out.overflow.map((i) => i.id)).toEqual([
      'builtin:channels',
      'builtin:notes',
      'builtin:workflows',
    ]);
  });

  it('overflows past the cap with first N shown and the rest hidden', () => {
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
    expect(out.visible).toHaveLength(MIN_VISIBLE_NAV_ITEMS);
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

  it('keeps the primary rail at three destinations', () => {
    const available = Array.from({ length: 6 }, (_, i) => item(`builtin:${i}`));
    const out = reconcileNavOrder(available, [], MAX_VISIBLE_NAV_ITEMS);

    expect(out.visible).toHaveLength(MAX_VISIBLE_NAV_ITEMS);
    expect(out.overflow).toHaveLength(3);
    expect(out.hasOverflow).toBe(true);
  });

  it('drops duplicate ids in stored order', () => {
    const available = [item('builtin:agents'), item('builtin:skills')];
    const stored = ['builtin:agents', 'builtin:agents', 'builtin:skills'];
    const out = reconcileNavOrder(available, stored);
    expect(out.visible.map((i) => i.id)).toEqual(['builtin:agents', 'builtin:skills']);
  });
});
