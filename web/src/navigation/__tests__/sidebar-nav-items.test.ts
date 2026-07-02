import { describe, expect, it } from 'vitest';

import {
  reconcileNavOrder,
  VISIBLE_NAV_CAP,
  VISIBLE_NAV_WHEN_OVERFLOW,
  type NavItem,
} from '@/navigation/sidebar-nav-items';

function item(id: string): NavItem {
  return { id, kind: id.startsWith('ext:') ? 'extension' : 'builtin', label: id, to: `/${id}`, Icon: undefined };
}

describe('reconcileNavOrder', () => {
  it('preserves the available order when nothing is stored', () => {
    const available = [item('builtin:agents'), item('builtin:skills'), item('builtin:automations'), item('builtin:channels')];
    const out = reconcileNavOrder(available, []);
    expect(out.hasOverflow).toBe(false);
    expect(out.visible.map((i) => i.id)).toEqual([
      'builtin:agents',
      'builtin:skills',
      'builtin:automations',
      'builtin:channels',
    ]);
    expect(out.overflow).toEqual([]);
  });

  it('honors stored order when items still exist', () => {
    const available = [item('builtin:agents'), item('builtin:skills'), item('builtin:automations'), item('builtin:channels')];
    const stored = ['builtin:channels', 'builtin:agents', 'builtin:automations', 'builtin:skills'];
    const out = reconcileNavOrder(available, stored);
    expect(out.visible.map((i) => i.id)).toEqual(stored);
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
      'builtin:channels',
    ]);
    expect(out.overflow.map((i) => i.id)).toEqual(['ext:foo:home']);
  });

  it('filters out stored ids that are no longer available', () => {
    const available = [item('builtin:agents'), item('builtin:automations')];
    const stored = ['ext:gone:page', 'builtin:automations', 'builtin:agents'];
    const out = reconcileNavOrder(available, stored);
    expect(out.visible.map((i) => i.id)).toEqual(['builtin:automations', 'builtin:agents']);
  });

  it('keeps every item visible when count equals the cap', () => {
    const available = Array.from({ length: VISIBLE_NAV_CAP }, (_, i) => item(`builtin:${i}`));
    const out = reconcileNavOrder(available, []);
    expect(out.hasOverflow).toBe(false);
    expect(out.visible).toHaveLength(VISIBLE_NAV_CAP);
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
    expect(out.visible).toHaveLength(VISIBLE_NAV_WHEN_OVERFLOW);
    expect(out.overflow.map((i) => i.id)).toEqual(['builtin:notes', 'builtin:workflows']);
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
    expect(out.visible).toHaveLength(VISIBLE_NAV_WHEN_OVERFLOW);
    expect(out.visible.map((i) => i.id)).toEqual([
      'builtin:agents',
      'builtin:skills',
      'builtin:automations',
      'builtin:channels',
    ]);
    expect(out.overflow.map((i) => i.id)).toEqual(['ext:foo:a', 'ext:bar:b', 'ext:baz:c']);
  });

  it('drops duplicate ids in stored order', () => {
    const available = [item('builtin:agents'), item('builtin:skills')];
    const stored = ['builtin:agents', 'builtin:agents', 'builtin:skills'];
    const out = reconcileNavOrder(available, stored);
    expect(out.visible.map((i) => i.id)).toEqual(['builtin:agents', 'builtin:skills']);
  });
});
