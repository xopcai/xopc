import type { PageContribution } from './types';

/** Router path for an extension page (matches `ExtensionPage` URL resolution). */
export function extensionPagePath(extensionId: string, page: PageContribution): string {
  if (page.path.startsWith('/apps/')) {
    return page.path;
  }
  const short = page.id.startsWith(`${extensionId}.`)
    ? page.id.slice(extensionId.length + 1)
    : page.id;
  return `/apps/${extensionId}/${short}`;
}
