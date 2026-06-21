import { useMemo, useState, useEffect } from 'react';

import { cn } from '@/lib/cn';
import { apiUrl } from '@/lib/url';
import { useGatewayStore } from '@/stores/gateway-store';

import {
  AGENT_AVATAR_UPDATED_EVENT,
  getAgentAvatarCacheRevision,
} from './agent-avatar-cache';
import {
  XOPC_CUSTOM_AVATAR,
  parseXopcDicebearValue,
  type StoredDicebearStyleId,
} from './agent-avatar-dicebear-value';

function hashString(value: string): number {
  let hash = 0;
  for (let i = 0; i < value.length; i += 1) {
    hash = (hash * 31 + value.charCodeAt(i)) >>> 0;
  }
  return hash;
}

function fallbackAvatarDataUri(agentId: string, size = 128): string {
  const hue = hashString(agentId) % 360;
  const label = (agentId.trim().charAt(0) || 'A').toUpperCase();
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}" viewBox="0 0 ${size} ${size}"><rect width="100%" height="100%" rx="${size / 2}" fill="hsl(${hue} 58% 42%)"/><text x="50%" y="54%" text-anchor="middle" dominant-baseline="middle" font-family="Inter, system-ui, sans-serif" font-size="${Math.round(size * 0.42)}" font-weight="700" fill="white">${label}</text></svg>`;
  return `data:image/svg+xml,${encodeURIComponent(svg)}`;
}

type ResolvedAvatar =
  | { kind: 'sync'; src: string }
  | { kind: 'dicebear'; styleId: StoredDicebearStyleId; seed: string; fallbackSrc: string };

function resolveAvatar(
  agentId: string,
  avatar: string | undefined,
  token: string | null | undefined,
  size: number,
  cacheRevision: number,
): ResolvedAvatar {
  const trimmed = avatar?.trim() ?? '';
  const fallbackSrc = fallbackAvatarDataUri(agentId, size);
  if (!trimmed) {
    return { kind: 'dicebear', styleId: 'adventurer', seed: agentId, fallbackSrc };
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
    return { kind: 'sync', src: qs ? `${u}?${qs}` : u };
  }
  if (/^https?:\/\//i.test(trimmed)) {
    return { kind: 'sync', src: trimmed };
  }
  const parsed = parseXopcDicebearValue(trimmed);
  if (parsed) {
    return { kind: 'dicebear', styleId: parsed.styleId, seed: parsed.seed, fallbackSrc };
  }
  return { kind: 'dicebear', styleId: 'adventurer', seed: agentId, fallbackSrc };
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

  const [, setCacheTick] = useState(0);
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
  const resolved = useMemo(
    () => resolveAvatar(agentId, avatar, token, size, cacheRevision),
    [agentId, avatar, token, size, cacheRevision],
  );
  const primarySrc = resolved.kind === 'sync' ? resolved.src : resolved.fallbackSrc;
  const [src, setSrc] = useState(primarySrc);

  useEffect(() => {
    setSrc(primarySrc);
  }, [primarySrc]);

  useEffect(() => {
    if (resolved.kind !== 'dicebear') return;
    let cancelled = false;
    void import('./agent-avatar-dicebear').then(({ dicebearToDataUri }) => {
      if (cancelled) return;
      setSrc(dicebearToDataUri(resolved.styleId, resolved.seed, size));
    });
    return () => {
      cancelled = true;
    };
  }, [resolved, size]);

  return (
    <img
      src={src}
      alt=""
      width={size}
      height={size}
      className={cn('rounded-full object-cover bg-surface-hover', props.className)}
      draggable={false}
      onError={() => {
        setSrc(fallbackAvatarDataUri(agentId, size));
      }}
    />
  );
}
