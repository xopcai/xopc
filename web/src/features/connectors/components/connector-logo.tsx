import { PackagePlus } from 'lucide-react';
import { useEffect, useState } from 'react';

import { cn } from '@/lib/cn';

import type { ConnectorDefinition } from '../connectors-api';

const sizeClasses = {
  sm: { frame: 'size-9 rounded-lg', image: 'size-6', fallback: 'size-4' },
  md: { frame: 'size-10 rounded-xl', image: 'size-7', fallback: 'size-5' },
  lg: { frame: 'size-12 rounded-xl', image: 'size-8', fallback: 'size-5' },
} as const;

export function ConnectorLogo({
  connector,
  size = 'md',
  className,
}: {
  connector?: Pick<ConnectorDefinition, 'branding' | 'displayName'>;
  size?: keyof typeof sizeClasses;
  className?: string;
}) {
  const logoUrl = connector?.branding?.logoUrl;
  const [logoFailed, setLogoFailed] = useState(false);
  const classes = sizeClasses[size];

  useEffect(() => {
    setLogoFailed(false);
  }, [logoUrl]);

  return (
    <span
      className={cn(
        'flex shrink-0 items-center justify-center overflow-hidden border border-edge bg-surface-base',
        classes.frame,
        className,
      )}
      style={connector?.branding?.backgroundColor ? { backgroundColor: connector.branding.backgroundColor } : undefined}
      title={connector?.displayName}
    >
      {logoUrl && !logoFailed ? (
        <img
          src={logoUrl}
          alt=""
          loading="lazy"
          draggable={false}
          className={cn('object-contain', classes.image)}
          onError={() => setLogoFailed(true)}
        />
      ) : (
        <PackagePlus className={cn('text-fg-muted', classes.fallback)} aria-hidden />
      )}
    </span>
  );
}
