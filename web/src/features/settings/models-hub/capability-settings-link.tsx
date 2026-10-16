import { Link, useSearchParams, type LinkProps } from 'react-router-dom';

import { withCapabilityReturnContext } from './capability-navigation';

/** Keep capability origin and chat return links through legacy voice settings. */
export function CapabilitySettingsLink({ to, ...props }: Omit<LinkProps, 'to'> & { to: string }) {
  const [context] = useSearchParams();
  return <Link {...props} to={withCapabilityReturnContext(to, context)} />;
}
