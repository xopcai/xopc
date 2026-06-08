import { useMemo, useRef, useState, useEffect } from 'react';

import { cn } from '@/lib/cn';
import { apiUrl } from '@/lib/url';
import { useGatewayStore } from '@/stores/gateway-store';

import {
  AGENT_AVATAR_UPDATED_EVENT,
  getAgentAvatarCacheRevision,
} from './agent-avatar-cache';
import {
  XOPC_CUSTOM_AVATAR,
  defaultAvatarDataUri,
  dicebearToDataUri,
  parseXopcDicebearValue,
} from './agent-avatar-dicebear';

function resolveAvatarSrc(
  agentId: string,
  avatar: string | undefined,
  token: string | null | undefined,
  size: number,
  cacheRevision: number,
): string {
  const trimmed = avatar?.trim() ?? '';
  if (!trimmed) {
    return defaultAvatarDataUri(agentId, size);
  }
  if (trimmed === XOPC_CUSTOM_AVATAR) {
    const u = apiUrl(`/api/agents/${encodeURIComponent(agentId)}/avatar`);
    const params = new URLSearchParams();
    if (token) {
      params.set('token', token);
    }
    if (cacheRevision > 0) {
      params.set('v', String(cacheRevision));
    }
    const qs = params.toString();
    return qs ? `${u}?${qs}` : u;
  }
  if (/^https?:\/\//i.test(trimmed)) {
    return trimmed;
  }
  const parsed = parseXopcDicebearValue(trimmed);
  if (parsed) {
    return dicebearToDataUri(parsed.styleId, parsed.seed, size);
  }
  return defaultAvatarDataUri(agentId, size);
}

export function AgentAvatarDisplay(props: {
  agentId: string;
  avatar?: string;
  size?: number;
  className?: string;
  token?: string | null;
}) {
  const storeToken = useGatewayStore((s) => s.token);
  const token = props.token !== undefined ? props.token : storeToken;
  const { agentId, avatar, size = 44 } = props;

  const [cacheTick, setCacheTick] = useState(0);
  useEffect(() => {
    const onUpdated = (event: Event) => {
      const detail = (event as CustomEvent<{ agentId?: string }>).detail;
      if (detail?.agentId === agentId) {
        setCacheTick((n) => n + 1);
      }
    };
    window.addEventListener(AGENT_AVATAR_UPDATED_EVENT, onUpdated);
    return () => window.removeEventListener(AGENT_AVATAR_UPDATED_EVENT, onUpdated);
  }, [agentId]);

  const cacheRevision = getAgentAvatarCacheRevision(agentId);
  const primarySrc = useMemo(
    () => resolveAvatarSrc(agentId, avatar, token, size, cacheRevision),
    [agentId, avatar, token, size, cacheRevision, cacheTick],
  );
  const [src, setSrc] = useState(primarySrc);
  const trackedPrimaryRef = useRef(primarySrc);
  if (trackedPrimaryRef.current !== primarySrc) {
    trackedPrimaryRef.current = primarySrc;
    setSrc(primarySrc);
  }

  return (
    <img
      src={src}
      alt=""
      width={size}
      height={size}
      className={cn('rounded-full object-cover bg-surface-hover', props.className)}
      draggable={false}
      onError={() => {
        setSrc(defaultAvatarDataUri(agentId, size));
      }}
    />
  );
}
