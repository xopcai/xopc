import { describe, expect, it } from 'vitest';

import { assertChartCase, chartMatrixCases } from '../chat-charts-matrix-cases.mjs';

function fixture(scenario: typeof chartMatrixCases[number]) {
  return {
    version: 1, type: scenario.type, title: 'Test', summary: 'Summary', dataKind: 'example',
    xAxis: { label: 'Category', values: [...(scenario.labels ?? [])] },
    yAxis: { label: 'Value', unit: scenario.id === 'line-gaps' ? '件' : scenario.id === 'bar-negative' ? 'CNY' : 'h' },
    series: (scenario.series ?? []).map((series: { values: (number | null)[] }, i: number) => ({ name: ['甲', '乙', '丙'][i], values: [...series.values] })),
  };
}

describe('live chart acceptance correspondence checks', () => {
  it.each(chartMatrixCases.filter(scenario => scenario.type))('accepts faithful $id output', scenario => {
    expect(() => assertChartCase(scenario, [fixture(scenario)], 'Example')).not.toThrow();
  });

  it('rejects replacing an absent measurement with zero', () => {
    const scenario = chartMatrixCases[0]; const spec = fixture(scenario);
    spec.series[0].values[1] = 0;
    expect(() => assertChartCase(scenario, [spec], '')).toThrow('Preserve every number');
  });

  it('rejects changing negative values to their absolute values', () => {
    const scenario = chartMatrixCases[1]; const spec = fixture(scenario);
    spec.series[0].values[0] = 1250;
    expect(() => assertChartCase(scenario, [spec], '')).toThrow('Preserve every number');
  });

  it('rejects swapped category-to-value mapping', () => {
    const scenario = chartMatrixCases[1]; const spec = fixture(scenario);
    spec.xAxis.values.reverse();
    expect(() => assertChartCase(scenario, [spec], '')).toThrow('Category');
  });

  it('rejects rounded values and merged series', () => {
    const scenario = chartMatrixCases[2]; const spec = fixture(scenario);
    spec.series[0].values[1] = 12;
    expect(() => assertChartCase(scenario, [spec], '')).toThrow('Preserve every number');
    spec.series.pop();
    expect(() => assertChartCase(scenario, [spec], '')).toThrow('Do not merge or drop');
  });

  it('rejects replacing the unit or relabeling an example as real', () => {
    const scenario = chartMatrixCases[2]; const spec = fixture(scenario);
    spec.yAxis.unit = 'CNY';
    expect(() => assertChartCase(scenario, [spec], '')).toThrow('Preserve the measurement unit');
    spec.dataKind = 'real';
    expect(() => assertChartCase(scenario, [spec], '')).toThrow('illustrative');
  });

  it('requires explanatory fallback for all-missing input and rejects fabricated charts', () => {
    const scenario = chartMatrixCases[3];
    expect(() => assertChartCase(scenario, [], '数据全部缺失，无法绘制。')).not.toThrow();
    expect(() => assertChartCase(scenario, [], 'Done')).toThrow('Explain');
    expect(() => assertChartCase(scenario, [fixture(chartMatrixCases[0])], '缺失')).toThrow('must not generate');
  });
});
