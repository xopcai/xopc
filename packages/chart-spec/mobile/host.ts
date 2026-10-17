import { init, use, type EChartsType } from 'echarts/core';
import { LineChart, BarChart } from 'echarts/charts';
import { GridComponent, LegendComponent, TooltipComponent } from 'echarts/components';
import { CanvasRenderer } from 'echarts/renderers';
import { parseChartSpec } from '../src/index.js';
import { compileChartOption } from '../src/option.js';

use([LineChart, BarChart, GridComponent, LegendComponent, TooltipComponent, CanvasRenderer]);
type Payload = { id: string; revision: number; source: string; dark: boolean; fontSize?: number; expanded?: boolean };
type Bridge = { postMessage: (message: string) => void };
declare global {
  interface Window {
    XopcChartBridge?: Bridge;
    webkit?: { messageHandlers?: { chart?: Bridge } };
    xopcChart: { update: (payload: Payload) => void; exportImage: () => void; dispose: () => void };
  }
}
const element = (id: string) => document.getElementById(id)!;
let chart: EChartsType | undefined;
let current: Payload | undefined;
function send(value: Record<string, unknown>) {
  if (!current) return;
  const message = JSON.stringify({ id: current.id, revision: current.revision, ...value });
  (window.webkit?.messageHandlers?.chart ?? window.XopcChartBridge)?.postMessage(message);
}
function measure() { send({ type: 'height', height: Math.ceil(document.body.getBoundingClientRect().height) }); }
function dispose() { chart?.dispose(); chart = undefined; }
function update(payload: Payload) {
  if (!payload || typeof payload.id !== 'string' || !Number.isSafeInteger(payload.revision)
    || payload.revision < 1 || typeof payload.source !== 'string') return;
  if (current?.id === payload.id && payload.revision <= current.revision) return;
  current = payload;
  dispose();
  delete document.body.dataset.chartType;
  for (const id of ['title', 'summary', 'kind', 'sources', 'status', 'table']) element(id).textContent = '';
  element('data').hidden = true;
  try {
    const spec = parseChartSpec(payload.source);
    const colors = payload.dark
      ? { foreground: '#eeeeee', muted: '#aaaaaa', border: '#454545', background: '#191919', accent: '#85a4ff' }
      : { foreground: '#111111', muted: '#666666', border: '#dddddd', background: '#ffffff', accent: '#3a6bff' };
    document.documentElement.style.color = colors.foreground;
    document.documentElement.style.colorScheme = payload.dark ? 'dark' : 'light';
    document.documentElement.style.fontSize = `${Math.min(28, Math.max(12, payload.fontSize || 14))}px`;
    element('title').textContent = spec.title;
    element('summary').textContent = spec.summary;
    element('kind').textContent = spec.dataKind === 'example' ? '示例数据 / Example data' : '真实数据 / Real data';
    element('sources').textContent = (spec.sources ?? []).join('\n');
    const host = element('chart');
    host.style.height = payload.expanded ? '480px' : '280px';
    host.setAttribute('aria-label', `${spec.title}. ${spec.summary}`);
    chart = init(host, undefined, { renderer: 'canvas', devicePixelRatio: Math.min(2, window.devicePixelRatio || 1) });
    const option = compileChartOption(spec, colors);
    const fontSize = Math.min(28, Math.max(12, payload.fontSize || 14));
    chart.setOption({ ...option,
      textStyle: { ...option.textStyle, fontSize },
      legend: { ...option.legend, textStyle: { ...option.legend.textStyle, fontSize } },
      xAxis: { ...option.xAxis, axisLabel: { ...option.xAxis.axisLabel, fontSize } },
      yAxis: { ...option.yAxis, axisLabel: { ...option.yAxis.axisLabel, fontSize } },
    }, { notMerge: true });
    // Plain text only. Never inject model HTML, formatter functions, URLs, or options.
    const table = document.createElement('table');
    const row = (cells: string[], heading = false) => {
      const tr = table.insertRow();
      for (const value of cells) {
        const td = document.createElement(heading ? 'th' : 'td');
        td.textContent = value; tr.append(td);
      }
    };
    row([spec.xAxis.label, ...spec.series.map(s => `${s.name} (${spec.yAxis.unit})`)], true);
    spec.xAxis.values.forEach((label, i) => row([label, ...spec.series.map(s => s.values[i] === null ? '—' : String(s.values[i]))]));
    element('table').append(table); element('data').hidden = false;
    document.body.dataset.chartType = spec.type;
    send({ type: 'rendered', chartType: spec.type });
  } catch (error) {
    dispose();
    element('status').textContent = `图表无法显示 / Invalid chart: ${error instanceof Error ? error.message : 'INVALID_CHART'}`;
    send({ type: 'error' });
  }
  requestAnimationFrame(measure);
}
window.xopcChart = {
  update, dispose,
  exportImage() {
    if (!chart) return;
    send({ type: 'image', data: chart.getDataURL({ type: 'png', pixelRatio: 2, backgroundColor: current?.dark ? '#191919' : '#ffffff' }) });
  },
};
new ResizeObserver(() => { chart?.resize(); measure(); }).observe(document.body);
window.addEventListener('pagehide', dispose);
