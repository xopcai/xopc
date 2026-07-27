import type { ReactNode } from 'react';

export function FieldHint({ children }: { children: ReactNode }) {
  return <p className="text-xs leading-relaxed text-fg-subtle">{children}</p>;
}
