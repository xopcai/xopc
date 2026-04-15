import { type CSSProperties, useEffect, useMemo, useRef, useState } from 'react';

import { useLocaleStore } from '@/stores/locale-store';
import { useThemeStore } from '@/stores/theme-store';
import { apiUrl } from '@/lib/url';

import { useExtensionRouter } from './extension-provider';
import { buildThemeInfo } from './theme-bridge';

const DEFAULT_MIN = 48;
const DEFAULT_MAX = 2000;

export type ExtensionIframeHostProps = {
  extensionId: string;
  entrypoint: string;
  permissions?: string[];
  title?: string;
  className?: string;
  fixedHeight?: number;
  maxHeight?: number;
  minHeight?: number;
  initialData?: unknown;
};

function encodeAssetPath(entrypoint: string): string {
  return entrypoint
    .split('/')
    .filter(Boolean)
    .map((seg) => encodeURIComponent(seg))
    .join('/');
}

export function ExtensionIframeHost({
  extensionId,
  entrypoint,
  permissions,
  title,
  className,
  fixedHeight,
  maxHeight = DEFAULT_MAX,
  minHeight = DEFAULT_MIN,
  initialData,
}: ExtensionIframeHostProps) {
  const router = useExtensionRouter();
  const iframeRef = useRef<HTMLIFrameElement>(null);
  const resolved = useThemeStore((s) => s.resolved);
  const [dynamicHeight, setDynamicHeight] = useState(
    fixedHeight ?? Math.min(maxHeight, Math.max(minHeight, 320)),
  );

  const src = useMemo(() => {
    const rel = encodeAssetPath(entrypoint);
    return apiUrl(`/api/extensions/${encodeURIComponent(extensionId)}/assets/${rel}`);
  }, [extensionId, entrypoint]);

  useEffect(() => {
    const el = iframeRef.current;
    if (!el) return;
    router.registerIframe(extensionId, el, permissions ?? []);
    return () => router.unregisterIframe(extensionId);
  }, [extensionId, permissions, router]);

  useEffect(() => {
    return router.subscribeExtensionEvents(extensionId, (msg) => {
      if (msg.event !== 'ui.resize') return;
      if (!msg.data || typeof msg.data !== 'object' || msg.data === null) return;
      const h = Number((msg.data as { height?: unknown }).height);
      if (!Number.isFinite(h)) return;
      const clamped = Math.min(maxHeight, Math.max(minHeight, h));
      if (fixedHeight === undefined) {
        setDynamicHeight(clamped);
      }
    });
  }, [extensionId, fixedHeight, maxHeight, minHeight, router]);

  useEffect(() => {
    const t = buildThemeInfo(resolved);
    router.sendEvent(extensionId, 'theme.changed', t);
  }, [extensionId, resolved, router]);

  const style: CSSProperties =
    fixedHeight !== undefined
      ? { width: '100%', height: fixedHeight, border: 'none' }
      : { width: '100%', height: dynamicHeight, border: 'none' };

  return (
    <iframe
      ref={iframeRef}
      className={className}
      title={title ?? `Extension ${extensionId}`}
      src={src}
      style={style}
      sandbox="allow-scripts allow-forms allow-popups allow-same-origin"
      referrerPolicy="no-referrer"
      onLoad={() => {
        const locale = useLocaleStore.getState().language;
        router.sendInit(extensionId, buildThemeInfo(useThemeStore.getState().resolved), locale);
        if (initialData !== undefined) {
          router.sendEvent(extensionId, 'widget.data', initialData);
        }
      }}
    />
  );
}
