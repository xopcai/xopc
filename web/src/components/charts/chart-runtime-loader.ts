/** Keep ECharts out of the initial Markdown chunk, including for incomplete or invalid charts. */
export function loadChartRuntime() {
  return import('./echarts-runtime');
}
