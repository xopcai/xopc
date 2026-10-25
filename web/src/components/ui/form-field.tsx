import { Children, cloneElement, isValidElement, useId, type ReactElement, type ReactNode } from 'react';

import { Select } from './popover-select';

/** Associates a visible label with a direct input or project-owned select. */
export function FormField({ label, children }: { label: string; children: ReactNode }) {
  const generatedId = useId();
  let controlId: string | undefined;
  const content = Children.map(children, (child, index) => {
    if (!isValidElement(child) || (child.type !== 'input' && child.type !== 'textarea' && child.type !== 'select' && child.type !== Select)) return child;
    const control = child as ReactElement<{ id?: string; 'aria-labelledby'?: string; 'aria-label'?: string }>;
    const id = control.props.id ?? `${generatedId}-${index}`;
    controlId ??= id;
    return cloneElement(control, {
      id,
      ...(!control.props['aria-label'] && !control.props['aria-labelledby'] ? { 'aria-labelledby': `${generatedId}-label` } : {}),
    });
  });
  return <div className="grid gap-1.5" role="group" aria-labelledby={`${generatedId}-label`}>
    {controlId
      ? <label id={`${generatedId}-label`} htmlFor={controlId} className="text-xs font-medium text-fg-muted">{label}</label>
      : <span id={`${generatedId}-label`} className="text-xs font-medium text-fg-muted">{label}</span>}
    {content}
  </div>;
}
