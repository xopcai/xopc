import { createAvatar } from '@dicebear/core';
import {
  adventurer,
  bottts,
  funEmoji,
  lorelei,
  pixelArt,
  thumbs,
} from '@dicebear/collection';
import { useEffect, useMemo, useState } from 'react';
import { Image, StyleSheet, Text, View } from 'react-native';
import { SvgXml } from 'react-native-svg';

import { useGatewayStore } from '../../stores/gateway-store';
import { useSettingsColors } from '../settings/settings-ui';

const XOPC_CUSTOM_AVATAR = 'xopc:custom';
const XOPC_DICEBEAR_PREFIX = 'xopc:dicebear:';

type StoredDicebearStyleId = 'adventurer' | 'bottts' | 'lorelei' | 'thumbs' | 'fun-emoji' | 'pixel-art';

const STORED_DICEBEAR_STYLES: readonly StoredDicebearStyleId[] = [
  'adventurer',
  'bottts',
  'lorelei',
  'thumbs',
  'fun-emoji',
  'pixel-art',
] as const;

function hashString(value: string): number {
  let hash = 0;
  for (let i = 0; i < value.length; i += 1) {
    hash = (hash * 31 + value.charCodeAt(i)) >>> 0;
  }
  return hash;
}

function hslToRgb(h: number, s: number, l: number): string {
  const a = s * Math.min(l, 1 - l);
  const f = (n: number) => {
    const k = (n + h / 30) % 12;
    return l - a * Math.max(Math.min(k - 3, 9 - k, 1), -1);
  };
  return `rgb(${Math.round(255 * f(0))}, ${Math.round(255 * f(8))}, ${Math.round(255 * f(4))})`;
}

function fallbackColor(agentId: string): string {
  return hslToRgb(hashString(agentId) % 360, 0.46, 0.42);
}

function fallbackLabel(agentId: string): string {
  return (agentId.trim().charAt(0) || 'A').toUpperCase();
}

function isStoredDicebearStyleId(value: string): value is StoredDicebearStyleId {
  return (STORED_DICEBEAR_STYLES as readonly string[]).includes(value);
}

function parseXopcDicebearValue(raw: string): { styleId: StoredDicebearStyleId; seed: string } | null {
  if (!raw.startsWith(XOPC_DICEBEAR_PREFIX)) return null;
  const rest = raw.slice(XOPC_DICEBEAR_PREFIX.length);
  const colon = rest.indexOf(':');
  if (colon <= 0) return null;
  const styleId = rest.slice(0, colon);
  const seed = rest.slice(colon + 1);
  if (!isStoredDicebearStyleId(styleId) || !seed.trim()) return null;
  return { styleId, seed };
}

function dicebearSvg(styleId: StoredDicebearStyleId, seed: string, size: number): string {
  const opts = { seed, size };
  switch (styleId) {
    case 'pixel-art':
      return createAvatar(pixelArt, opts).toString();
    case 'adventurer':
      return createAvatar(adventurer, opts).toString();
    case 'bottts':
      return createAvatar(bottts, opts).toString();
    case 'lorelei':
      return createAvatar(lorelei, opts).toString();
    case 'thumbs':
      return createAvatar(thumbs, opts).toString();
    case 'fun-emoji':
      return createAvatar(funEmoji, opts).toString();
  }
}

function resolveDicebear(agentId: string, avatar: string | undefined): { styleId: StoredDicebearStyleId; seed: string } {
  const parsed = parseXopcDicebearValue(avatar?.trim() ?? '');
  return parsed ?? { styleId: 'adventurer', seed: agentId };
}

function avatarUri(agentId: string, avatar: string | undefined): string | null {
  const trimmed = avatar?.trim() ?? '';
  if (!trimmed) return null;
  if (trimmed === XOPC_CUSTOM_AVATAR) {
    return useGatewayStore.getState().apiUrl(`/api/agents/${encodeURIComponent(agentId)}/avatar`);
  }
  if (/^(https?:|data:image\/)/i.test(trimmed)) return trimmed;
  return null;
}

export function AgentAvatar({
  agentId,
  avatar,
  size,
}: {
  agentId: string;
  avatar?: string;
  size: number;
}) {
  const colors = useSettingsColors();
  const token = useGatewayStore((s) => s.token);
  const activeBaseUrl = useGatewayStore((s) => s.activeBaseUrl);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    setFailed(false);
  }, [agentId, avatar, activeBaseUrl, token]);

  const uri = useMemo(() => avatarUri(agentId, avatar), [agentId, avatar, activeBaseUrl]);
  const authHeaders = token ? { Authorization: `Bearer ${token}` } : undefined;
  const dicebear = useMemo(() => resolveDicebear(agentId, avatar), [agentId, avatar]);
  const svg = useMemo(
    () => dicebearSvg(dicebear.styleId, dicebear.seed, Math.max(size * 2, 96)),
    [dicebear, size],
  );
  const radius = Math.round(size * 0.28);

  if (uri && !failed) {
    return (
      <View
        style={[
          styles.wrap,
          { width: size, height: size, borderRadius: radius, backgroundColor: colors.accentSoft },
        ]}
      >
        <Image
          source={{ uri, headers: authHeaders }}
          style={{ width: size, height: size, borderRadius: radius }}
          resizeMode="cover"
          onError={() => setFailed(true)}
        />
      </View>
    );
  }

  if (!failed) {
    return (
      <View
        style={[
          styles.wrap,
          { width: size, height: size, borderRadius: radius, backgroundColor: colors.accentSoft },
        ]}
      >
        <SvgXml
          xml={svg}
          width={size}
          height={size}
          onError={() => setFailed(true)}
        />
      </View>
    );
  }

  return (
    <View
      style={[
        styles.wrap,
        { width: size, height: size, borderRadius: radius, backgroundColor: fallbackColor(agentId) },
      ]}
    >
      <Text style={[styles.label, { fontSize: Math.round(size * 0.42) }]}>{fallbackLabel(agentId)}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: {
    alignItems: 'center',
    justifyContent: 'center',
    overflow: 'hidden',
  },
  label: {
    color: '#fff',
    fontWeight: '700',
  },
});
