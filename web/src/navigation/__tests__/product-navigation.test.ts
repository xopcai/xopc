import { describe, expect, it } from 'vitest';

import {
  PRODUCT_DOMAINS,
  productDomainAtPath,
  productSectionAtLocation,
  showsProductSectionHeader,
} from '@/navigation/product-navigation';

describe('product navigation', () => {
  it('keeps four fixed product domains in the intended order', () => {
    expect(PRODUCT_DOMAINS.map((domain) => domain.id)).toEqual([
      'work',
      'automation',
      'capabilities',
      'apps',
    ]);
  });

  it.each([
    ['/', 'work'],
    ['/chat/abc', 'work'],
    ['/tasks/task-1', 'work'],
    ['/projects/project-1/notes/note-1', 'work'],
    ['/notes/note-1', 'work'],
    ['/automations', 'automation'],
    ['/scenes/inbox', 'automation'],
    ['/workflows/example/edit', 'automation'],
    ['/browser-automations', 'automation'],
    ['/capabilities/connectors', 'capabilities'],
    ['/extensions/example/page', 'capabilities'],
    ['/local-apps/example', 'apps'],
    ['/open', 'apps'],
    ['/settings/overview', null],
  ] as const)('maps %s to %s', (pathname, domain) => {
    expect(productDomainAtPath(pathname)).toBe(domain);
  });

  it('distinguishes automation activity from trigger management without changing the route', () => {
    expect(productSectionAtLocation('/automations', '?view=activity')).toBe('automation-activity');
    expect(productSectionAtLocation('/automations', '?view=activity&status=running')).toBe('automation-activity');
    expect(productSectionAtLocation('/automations', '?status=running')).toBe('automation-triggers');
  });

  it('keeps detail routes associated with their parent section', () => {
    expect(productSectionAtLocation('/projects/project-1/settings')).toBe('work-projects');
    expect(productSectionAtLocation('/notes/note-1')).toBe('work-notes');
    expect(productSectionAtLocation('/workflows/example/edit')).toBe('automation-workflows');
    expect(productSectionAtLocation('/extensions/example/settings')).toBe('capabilities-extensions');
  });

  it('preserves conversation chrome while keeping work active in the primary navigation', () => {
    expect(productDomainAtPath('/chat/abc')).toBe('work');
    expect(showsProductSectionHeader('/chat/abc')).toBe(false);
    expect(showsProductSectionHeader('/projects/project-1')).toBe(true);
  });
});
