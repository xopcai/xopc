import { describe, expect, it } from 'vitest';
import { parseChartSpec } from '@xopcai/chart-spec';

import { compileChartOption } from '../chart-option';

describe('host chart option compiler', () => {
  it.each(['line', 'bar'])('compiles %s with safe tooltips, original gaps and a zero baseline', type => {
    const spec = parseChartSpec(JSON.stringify({
      version: 1, type, title: 'Test', summary: 'Summary', dataKind: 'example',
      xAxis: { label: 'Month', values: ['B', 'A'] }, yAxis: { label: 'Amount', unit: 'CNY' },
      series: [{ name: '<img src=x onerror=alert(1)>', values: [null, -2] }],
    }));
    const before = JSON.stringify(spec);
    const option = compileChartOption(spec, { foreground: 'white', muted: 'gray', border: 'gray', background: 'black', accent: 'blue' });
    expect(option).toMatchObject({
      animation: false, backgroundColor: 'black',
      tooltip: { renderMode: 'richText', confine: true },
      xAxis: { data: ['B', 'A'] }, yAxis: { scale: false },
      series: [{ type, data: [null, -2] }],
    });
    expect(JSON.stringify(option)).not.toContain('formatter');
    expect(JSON.stringify(spec)).toBe(before);
  });
});
