import type { ChartSpec } from '@xopcai/chart-spec';
import type { EChartsType } from 'echarts/core';
import { Download } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';

import { Skeleton } from '@/components/ui/skeleton';
import { messages } from '@/i18n/messages';
import { useLocaleStore } from '@/stores/locale-store';

import { compileChartOption, readChartColors } from './chart-option';
import { loadChartRuntime } from './chart-runtime-loader';

export function ChartCanvas({ spec, onError, expanded = false }: {
  spec: ChartSpec; onError: () => void; expanded?: boolean;
}) {
  const host = useRef<HTMLDivElement>(null);
  const instance = useRef<EChartsType | null>(null);
  const [ready, setReady] = useState(false);
  const [downloadFailed, setDownloadFailed] = useState(false);
  const locale = useLocaleStore(s => s.language);
  const labels = messages(locale).chat.chart;

  useEffect(() => {
    const element = host.current;
    if (!element) return;
    let current = true;
    let runtime: typeof import('./echarts-runtime') | undefined;
    let frame: number | undefined;
    let lastWidth = 0;
    let lastHeight = 0;
    let lastColors = '';
    setReady(false);
    const update = () => {
      const width = element.clientWidth;
      const height = element.clientHeight;
      if (!current || !runtime || width <= 0 || height <= 0) return;
      try {
        const colors = readChartColors(element);
        const colorKey = JSON.stringify(colors);
        if (!instance.current) {
          instance.current = runtime.init(element, undefined, { renderer: 'canvas', devicePixelRatio: Math.min(window.devicePixelRatio || 1, 2) });
          setReady(true);
        }
        if (colorKey !== lastColors) {
          instance.current.setOption(compileChartOption(spec, colors), { notMerge: true });
          lastColors = colorKey;
        }
        if (lastWidth && (width !== lastWidth || height !== lastHeight)) {
          instance.current.resize();
        }
        lastWidth = width;
        lastHeight = height;
      } catch {
        instance.current?.dispose();
        instance.current = null;
        onError();
      }
    };
    const scheduleUpdate = () => {
      if (!current || frame !== undefined) return;
      frame = requestAnimationFrame(() => { frame = undefined; update(); });
    };
    const observer = typeof ResizeObserver === 'undefined' ? null : new ResizeObserver(scheduleUpdate);
    observer?.observe(element);
    // View transitions apply DOM theme attributes after the store notification.
    const themeObserver = new MutationObserver(scheduleUpdate);
    themeObserver.observe(document.documentElement, { attributes: true,
      attributeFilter: ['class', 'data-theme', 'data-color-scheme', 'style'] });
    window.addEventListener('resize', scheduleUpdate);
    void loadChartRuntime().then(value => {
      if (!current) return;
      runtime = value;
      update();
    }).catch(() => { if (current) onError(); });
    return () => {
      current = false;
      if (frame !== undefined) cancelAnimationFrame(frame);
      observer?.disconnect();
      themeObserver.disconnect();
      window.removeEventListener('resize', scheduleUpdate);
      instance.current?.dispose();
      instance.current = null;
    };
  }, [spec, onError]);

  const download = () => {
    if (!instance.current) return;
    try {
      const chart = instance.current;
      const scale = Math.min(2, 8192 / chart.getWidth(), 8192 / chart.getHeight(), Math.sqrt(32_000_000 / (chart.getWidth() * chart.getHeight())));
      const url = chart.getDataURL({ type: 'png', pixelRatio: scale });
      const link = document.createElement('a');
      link.href = url;
      link.download = 'chart.png';
      document.body.append(link);
      link.click();
      link.remove();
      setDownloadFailed(false);
    } catch { setDownloadFailed(true); }
  };

  return <div className={expanded ? 'relative h-full min-h-0' : 'relative h-[280px] sm:h-[360px]'}>
    <div ref={host} className="h-full w-full" role="img" aria-label={`${spec.title}. ${spec.summary}`} />
    {!ready && <div className="absolute inset-0 p-4" role="status" aria-label={labels.loading}><Skeleton className="h-full w-full" /></div>}
    {ready && <button type="button" className="absolute bottom-1 right-1 flex min-h-9 items-center gap-1 rounded-md bg-surface-overlay px-2 text-xs text-fg-muted hover:text-fg focus-visible:outline-2 focus-visible:outline-accent" onClick={download} aria-label={labels.download}><Download className="size-4" aria-hidden />PNG</button>}
    {downloadFailed && <p role="status" className="absolute bottom-10 right-2 bg-surface-overlay p-2 text-xs text-fg-muted">{labels.downloadFailed}</p>}
  </div>;
}
