/**
 * ExtensionNavItems — sidebar navigation for extension pages with `showInNav: true`.
 */

import { icons } from 'lucide-react';
import type { ForwardRefExoticComponent, RefAttributes, SVGProps } from 'react';
import { NavLink } from 'react-router-dom';

import { useUiExtensions } from './extension-provider';
import { extensionPagePath } from './extension-paths';
import type { ExtensionUiInfo, PageContribution } from './types';

type LucideIcon = ForwardRefExoticComponent<
  Omit<SVGProps<SVGSVGElement>, 'ref'> & RefAttributes<SVGSVGElement>
>;

/** Resolve a Lucide icon by kebab-case name (e.g. "hand-metal" → HandMetal). */
function resolveLucideIcon(name: string): LucideIcon | undefined {
  const pascalCase = name
    .split('-')
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join('');
  return (icons as Record<string, LucideIcon | undefined>)[pascalCase];
}

interface ExtensionNavItemsProps {
  collapsed?: boolean;
  onNavigate?: () => void;
  navLinkClassName: (props: { isActive: boolean }, collapsed: boolean) => string;
}

export function ExtensionNavItems({
  collapsed = false,
  onNavigate,
  navLinkClassName,
}: ExtensionNavItemsProps) {
  const uiExtensions = useUiExtensions();

  const navPages = collectNavPages(uiExtensions);
  if (navPages.length === 0) return null;

  return (
    <>
      {navPages.map(({ extension, page }) => {
        const Icon = page.navIcon ? resolveLucideIcon(page.navIcon) : undefined;
        const path = extensionPagePath(extension.id, page);

        return (
          <NavLink
            key={`${extension.id}:${page.id}`}
            to={path}
            className={(props) => navLinkClassName(props, collapsed)}
            title={page.title}
            onClick={() => onNavigate?.()}
          >
            {Icon ? (
              <Icon className="size-4 shrink-0 opacity-90" strokeWidth={1.75} aria-hidden />
            ) : (
              <span
                className="flex size-4 shrink-0 items-center justify-center text-[10px] font-bold opacity-70"
                aria-hidden
              >
                {page.title.charAt(0).toUpperCase()}
              </span>
            )}
            {!collapsed ? <span className="truncate">{page.title}</span> : null}
          </NavLink>
        );
      })}
    </>
  );
}

function collectNavPages(
  extensions: ExtensionUiInfo[],
): Array<{ extension: ExtensionUiInfo; page: PageContribution }> {
  const result: Array<{ extension: ExtensionUiInfo; page: PageContribution }> = [];
  for (const extension of extensions) {
    const pages = extension.ui?.contributions?.pages;
    if (!pages) continue;
    for (const page of pages) {
      if (page.showInNav) {
        result.push({ extension, page });
      }
    }
  }
  return result;
}
