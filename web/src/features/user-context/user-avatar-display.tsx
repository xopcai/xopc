import { useEffect, useMemo, useState, type ReactNode } from 'react';

import { cn } from '@/lib/cn';
import { apiUrl } from '@/lib/url';
import { useGatewayStore } from '@/stores/gateway-store';

import {
  getUserAvatarCacheRevision,
  USER_AVATAR_UPDATED_EVENT,
} from './user-avatar-cache';

export function UserAvatarDisplay({
  callName,
  size = 44,
  className,
  fallback,
}: {
  callName?: string;
  size?: number;
  className?: string;
  fallback?: ReactNode;
}) {
  const token = useGatewayStore((state) => state.token);
  const [cacheTick, setCacheTick] = useState(0);
  const [imageFailed, setImageFailed] = useState(false);
  const [avatarPresence, setAvatarPresence] = useState<boolean | undefined>(undefined);
  const initial = [...(callName?.trim() || 'You')][0]?.toLocaleUpperCase() ?? 'Y';

  useEffect(() => {
    const onUpdated = (event: Event) => {
      const { hasAvatar } = (event as CustomEvent<{ hasAvatar?: boolean }>).detail ?? {};
      setAvatarPresence(hasAvatar);
      setImageFailed(hasAvatar === false);
      setCacheTick((value) => value + 1);
    };
    window.addEventListener(USER_AVATAR_UPDATED_EVENT, onUpdated);
    return () => window.removeEventListener(USER_AVATAR_UPDATED_EVENT, onUpdated);
  }, []);

  const src = useMemo(() => {
    const params = new URLSearchParams();
    if (token) params.set('token', token);
    const revision = getUserAvatarCacheRevision();
    if (revision > 0) params.set('v', String(revision));
    const query = params.toString();
    const url = apiUrl('/api/you/avatar');
    return query ? `${url}?${query}` : url;
  }, [cacheTick, token]);

  useEffect(() => {
    if (avatarPresence !== false) setImageFailed(false);
  }, [avatarPresence, src]);

  if (avatarPresence === false || imageFailed) {
    if (fallback) {
      return (
        <span
          style={className ? undefined : { width: size, height: size }}
          className={cn('inline-flex shrink-0 overflow-hidden rounded-full', className)}
        >
          {fallback}
        </span>
      );
    }
    return (
      <span
        role="img"
        aria-label={callName?.trim() || initial}
        style={className ? undefined : { width: size, height: size }}
        className={cn(
          'inline-flex shrink-0 items-center justify-center rounded-full bg-accent-soft font-semibold text-accent-fg',
          className,
        )}
      >
        {initial}
      </span>
    );
  }

  return (
    <img
      src={src}
      alt=""
      width={size}
      height={size}
      className={cn('shrink-0 rounded-full bg-surface-hover object-cover', className)}
      draggable={false}
      onError={() => setImageFailed(true)}
    />
  );
}
