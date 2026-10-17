import { compileChartOption as compileSharedChartOption, type ChartColors } from '@xopcai/chart-spec/option';
import type { ChartSpec } from '@xopcai/chart-spec';
import type { BarSeriesOption, LineSeriesOption } from 'echarts/charts';
import type { GridComponentOption, LegendComponentOption, TooltipComponentOption } from 'echarts/components';
import type { ComposeOption } from 'echarts/core';

export type ChartOption = ComposeOption<BarSeriesOption | LineSeriesOption | GridComponentOption | LegendComponentOption | TooltipComponentOption>;

export { type ChartColors } from '@xopcai/chart-spec/option';
export function compileChartOption(spec: ChartSpec, colors: ChartColors): ChartOption {
  return compileSharedChartOption(spec, colors) as ChartOption;
}

export function readChartColors(host: HTMLElement): ChartColors {
  const style = getComputedStyle(host);
  const color = (name: string, fallback: string) => style.getPropertyValue(name).trim() || fallback;
  return {
    foreground: color('--color-fg', '#111111'), muted: color('--color-fg-muted', '#666666'),
    border: color('--color-edge', '#ececec'), background: color('--color-surface-panel', '#ffffff'),
    accent: color('--color-accent', '#3a6bff'),
  };
}
