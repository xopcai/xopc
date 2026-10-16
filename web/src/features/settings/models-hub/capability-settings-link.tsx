import { createContext, useContext } from 'react';
import type { ModelSetupUse } from '@xopcai/gateway-contract';
import { Link, useSearchParams, type LinkProps } from 'react-router-dom';

import { parseCapabilityUse, withCapabilityReturnContext } from './capability-navigation';

export const CapabilityConnectionContext = createContext<((use: ModelSetupUse) => void) | null>(null);

/** Keep capability origin and chat return links through legacy voice settings. */
export function CapabilitySettingsLink({ to, ...props }: Omit<LinkProps, 'to'> & { to: string }) {
  const [context] = useSearchParams();
  const connect = useContext(CapabilityConnectionContext);
  const query = new URLSearchParams(to.split('?')[1] ?? '');
  const use = parseCapabilityUse(query.get('use'));
  return <Link {...props} onClick={event => { props.onClick?.(event); if (!event.defaultPrevented && !event.metaKey && !event.ctrlKey && !event.shiftKey && event.button === 0 && connect && use && query.get('view') === 'services') { event.preventDefault(); connect(use); } }} to={withCapabilityReturnContext(to, context)} />;
}
