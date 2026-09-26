import { describe, expect, it } from 'vitest';

import {
  PRODUCT_DOMAINS,
  productDomainAtPath,
  productSectionAtLocation,
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

  it('keeps automation destinations focused on distinct top-level tools', () => {
    expect(PRODUCT_DOMAINS.find((domain) => domain.id === 'automation')?.sections.map((section) => section.id)).toEqual([
      'automation-scenes',
      'automation-triggers',
      'automation-workflows',
      'automation-browser',
    ]);
  });

  it('removes capability discovery and falls back to skills', () => {
    expect(PRODUCT_DOMAINS.find((domain) => domain.id === 'capabilities')?.sections.map((section) => section.id)).toEqual([
      'capabilities-skills',
      'capabilities-connectors',
      'capabilities-agents',
      'capabilities-channels',
      'capabilities-extensions',
    ]);
    expect(productSectionAtLocation('/capabilities')).toBe('capabilities-skills');
    expect(productSectionAtLocation('/capabilities/discover')).toBe('capabilities-skills');
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
    ['/extensions/example/page', null],
    ['/local-apps/example', 'apps'],
    ['/open', 'apps'],
    ['/settings/overview', null],
  ] as const)('maps %s to %s', (pathname, domain) => {
    expect(productDomainAtPath(pathname)).toBe(domain);
  });

  it('treats activity as an internal view of Automations', () => {
    expect(productSectionAtLocation('/automations', '?view=activity')).toBe('automation-triggers');
    expect(productSectionAtLocation('/automations', '?view=activity&status=running')).toBe('automation-triggers');
    expect(productSectionAtLocation('/automations', '?status=running')).toBe('automation-triggers');
  });

  it('keeps detail routes associated with their parent section', () => {
    expect(productSectionAtLocation('/projects/project-1/settings')).toBe('work-projects');
    expect(productSectionAtLocation('/notes/note-1')).toBe('work-notes');
    expect(productSectionAtLocation('/workflows/example/edit')).toBe('automation-workflows');
    expect(productSectionAtLocation('/extensions/example/settings')).toBeNull();
    expect(productSectionAtLocation('/capabilities/extensions')).toBe('capabilities-extensions');
  });

  it('keeps extension app pages outside the built-in product domains', () => {
    expect(productDomainAtPath('/extensions/example/dashboard')).toBeNull();
  });
});
