export type ProductDomainId = 'work' | 'automation' | 'capabilities' | 'apps';

export type ProductSectionId =
  | 'work-overview'
  | 'work-projects'
  | 'work-notes'
  | 'automation-activity'
  | 'automation-scenes'
  | 'automation-triggers'
  | 'automation-workflows'
  | 'automation-browser'
  | 'capabilities-agents'
  | 'capabilities-skills'
  | 'capabilities-connectors'
  | 'capabilities-channels'
  | 'capabilities-extensions'
  | 'apps-library';

type ProductSectionDefinition = {
  id: ProductSectionId;
  domain: ProductDomainId;
  path: string;
};

type ProductDomainDefinition = {
  id: ProductDomainId;
  path: string;
  sections: readonly ProductSectionDefinition[];
};

const workSections = [
  { id: 'work-overview', domain: 'work', path: '/' },
  { id: 'work-projects', domain: 'work', path: '/projects' },
  { id: 'work-notes', domain: 'work', path: '/notes' },
] as const satisfies readonly ProductSectionDefinition[];

const automationSections = [
  { id: 'automation-triggers', domain: 'automation', path: '/automations' },
  { id: 'automation-scenes', domain: 'automation', path: '/scenes' },
  { id: 'automation-workflows', domain: 'automation', path: '/workflows' },
  { id: 'automation-browser', domain: 'automation', path: '/browser-automations' },
  { id: 'automation-activity', domain: 'automation', path: '/automations?view=activity' },
] as const satisfies readonly ProductSectionDefinition[];

export const CAPABILITY_SECTIONS = ['skills', 'connectors', 'agents', 'channels', 'extensions'] as const;
export type CapabilitySection = typeof CAPABILITY_SECTIONS[number];

const capabilitySections = CAPABILITY_SECTIONS.map((section) => ({
  id: `capabilities-${section}`,
  domain: 'capabilities' as const,
  path: `/capabilities/${section}`,
})) satisfies readonly ProductSectionDefinition[];

export function capabilityPath(section: CapabilitySection): string {
  return `/capabilities/${section}`;
}

const appSections = [
  { id: 'apps-library', domain: 'apps', path: '/local-apps' },
] as const satisfies readonly ProductSectionDefinition[];

export const PRODUCT_DOMAINS = [
  { id: 'work', path: '/', sections: workSections },
  { id: 'automation', path: '/automations', sections: automationSections },
  { id: 'capabilities', path: '/capabilities/skills', sections: capabilitySections },
  { id: 'apps', path: '/local-apps', sections: appSections },
] as const satisfies readonly ProductDomainDefinition[];

function isPath(pathname: string, root: string): boolean {
  return pathname === root || pathname.startsWith(`${root}/`);
}

export function productDomainAtPath(pathname: string): ProductDomainId | null {
  if (pathname === '/' || isPath(pathname, '/chat') || isPath(pathname, '/tasks') || isPath(pathname, '/projects') || isPath(pathname, '/notes')) {
    return 'work';
  }
  if (isPath(pathname, '/automations') || isPath(pathname, '/scenes') || isPath(pathname, '/workflows') || isPath(pathname, '/browser-automations')) {
    return 'automation';
  }
  if (isPath(pathname, '/capabilities')) {
    return 'capabilities';
  }
  if (isPath(pathname, '/local-apps') || isPath(pathname, '/open')) {
    return 'apps';
  }
  return null;
}

export function productSectionAtLocation(pathname: string, search = ''): ProductSectionId | null {
  if (pathname === '/') return 'work-overview';
  if (isPath(pathname, '/projects')) return 'work-projects';
  if (isPath(pathname, '/notes')) return 'work-notes';
  if (isPath(pathname, '/automations')) {
    return new URLSearchParams(search).get('view') === 'activity'
      ? 'automation-activity'
      : 'automation-triggers';
  }
  if (isPath(pathname, '/scenes')) return 'automation-scenes';
  if (isPath(pathname, '/workflows')) return 'automation-workflows';
  if (isPath(pathname, '/browser-automations')) return 'automation-browser';
  if (isPath(pathname, '/local-apps') || isPath(pathname, '/open')) return 'apps-library';
  if (isPath(pathname, '/capabilities')) {
    const section = pathname.split('/')[2];
    const candidate = `capabilities-${section || 'skills'}` as ProductSectionId;
    return capabilitySections.some((item) => item.id === candidate)
      ? candidate
      : 'capabilities-skills';
  }
  return null;
}

export function productDomainDefinition(id: ProductDomainId): ProductDomainDefinition {
  return PRODUCT_DOMAINS.find((domain) => domain.id === id)!;
}

export function showsProductSectionHeader(pathname: string): boolean {
  if (isPath(pathname, '/chat') || isPath(pathname, '/tasks')) return false;
  const domain = productDomainAtPath(pathname);
  return domain === 'work' || domain === 'automation' || domain === 'capabilities';
}
