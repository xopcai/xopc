import { useEffect, useState, type ComponentType, type SVGProps } from 'react';

import { cn } from '@/lib/cn';

type IconComponent = ComponentType<SVGProps<SVGSVGElement>>;

export function CapabilityIcon({
  iconUrl,
  fallback: Fallback,
  className,
}: {
  iconUrl?: string;
  fallback: IconComponent;
  className?: string;
}) {
  const [failed, setFailed] = useState(false);
  useEffect(() => setFailed(false), [iconUrl]);

  return (
    <span className={cn('flex size-10 shrink-0 items-center justify-center overflow-hidden rounded-xl border border-edge bg-white', className)}>
      {iconUrl && !failed ? (
        <img
          src={iconUrl}
          alt=""
          loading="lazy"
          draggable={false}
          className="size-8 object-contain"
          onError={() => setFailed(true)}
        />
      ) : (
        <Fallback className="size-5 text-fg-muted" aria-hidden />
      )}
    </span>
  );
}
