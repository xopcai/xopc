import { icons } from 'lucide-react';
import type { ForwardRefExoticComponent, RefAttributes, SVGProps } from 'react';

export type LucideIcon = ForwardRefExoticComponent<
  Omit<SVGProps<SVGSVGElement>, 'ref'> & RefAttributes<SVGSVGElement>
>;

/** Resolve a Lucide icon by kebab-case name (e.g. "hand-metal" → HandMetal). */
export function resolveLucideIcon(name: string): LucideIcon | undefined {
  const pascalCase = name
    .split('-')
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join('');
  return (icons as Record<string, LucideIcon | undefined>)[pascalCase];
}
