import type { ReactNode } from 'react';

export function FieldLabel({ children }: { children: ReactNode }) {
  return <div className="text-sm font-medium text-fg">{children}</div>;
}
