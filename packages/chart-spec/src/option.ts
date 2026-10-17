import type { ChartSpec } from './index.js';

export type ChartColors = { foreground: string; muted: string; border: string; background: string; accent: string };

/** Only host-owned options reach ECharts; spec text and numbers remain data. */
export function compileChartOption(spec: ChartSpec, colors: ChartColors) {
  return {
    animation: false,
    backgroundColor: colors.background,
    color: [colors.accent, colors.muted, '#659c95', '#b49166', '#927daf'],
    textStyle: { color: colors.foreground, fontFamily: 'sans-serif' },
    grid: { left: 16, right: 24, top: 84, bottom: 48, outerBoundsMode: 'same', outerBoundsContain: 'all' },
    legend: { type: 'scroll', top: 8, textStyle: { color: colors.foreground, width: 160, overflow: 'truncate' } },
    tooltip: { trigger: 'axis', renderMode: 'richText', confine: true },
    xAxis: {
      type: 'category', data: [...spec.xAxis.values], name: spec.xAxis.label,
      nameLocation: 'middle', nameGap: 32, nameTextStyle: { color: colors.muted },
      boundaryGap: spec.type === 'bar',
      axisLabel: { color: colors.muted, width: 72, overflow: 'truncate', hideOverlap: true },
      axisLine: { lineStyle: { color: colors.border } }, axisTick: { show: false },
    },
    yAxis: {
      type: 'value', name: `${spec.yAxis.label} (${spec.yAxis.unit})`,
      nameTextStyle: { color: colors.muted, width: 200, overflow: 'truncate', align: 'left' },
      scale: false,
      axisLabel: { color: colors.muted },
      splitLine: { lineStyle: { color: colors.border } },
    },
    series: spec.series.map((series, index) => spec.type === 'line' ? {
      name: series.name, type: 'line', data: [...series.values],
      smooth: false, connectNulls: false, showSymbol: spec.xAxis.values.length <= 100,
      symbol: ['circle', 'rect', 'triangle', 'diamond', 'roundRect'][index % 5],
      lineStyle: { type: index % 2 ? 'dashed' : 'solid' },
    } : {
      name: series.name, type: 'bar', data: [...series.values], barMaxWidth: 40,
    }),
  };
}
