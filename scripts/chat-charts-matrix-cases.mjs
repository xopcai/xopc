import assert from 'node:assert/strict';

const introduction = '请直接在聊天回复中画图并用一句中文说明；下面都是演示数据，不是真实业务数据。';

export const chartMatrixCases = [
  {
    id: 'line-gaps',
    prompt: `${introduction}用一张折线图比较甲、乙两个设备五个月的产量（单位：件）。按给定月份保留所有位置，没记录的地方保持缺口，不补值，也不能当作零。月份依次为2026-01、2026-02、2026-03、2026-04、2026-05。甲设备依次为12、没记录、18、0、21；乙设备依次为9、11、没记录、14、17。`,
    type: 'line',
    unitPattern: /^(?:件|count|counts|pcs|pieces|items)$/i,
    labels: ['2026-01', '2026-02', '2026-03', '2026-04', '2026-05'],
    labelPatterns: [/^(?:2026[-年])?0?1月?$/, /^(?:2026[-年])?0?2月?$/, /^(?:2026[-年])?0?3月?$/, /^(?:2026[-年])?0?4月?$/, /^(?:2026[-年])?0?5月?$/],
    series: [{ name: /甲/, values: [12, null, 18, 0, 21] }, { name: /乙/, values: [9, 11, null, 14, 17] }],
  },
  {
    id: 'bar-negative',
    prompt: `${introduction}用一张柱状图比较各部门净收支（单位：元）：部门甲为-1250，部门乙为0，部门丙为875，部门丁为-420。保持甲、乙、丙、丁的顺序，负数必须保留负号，不能取绝对值，也不能删掉零值。`,
    type: 'bar', labels: ['部门甲', '部门乙', '部门丙', '部门丁'], unitPattern: /^(?:CNY|RMB|元|人民币|人民币元|¥|￥)$/i,
    labelPatterns: [/甲/, /乙/, /丙/, /丁/],
    series: [{ name: /./, values: [-1250, 0, 875, -420] }],
  },
  {
    id: 'bar-multi-series',
    prompt: `${introduction}用一张分组柱状图比较甲、乙、丙三个小组四周的投入时长（单位：小时），不要合计、四舍五入或堆叠。横轴依次为第1周、第2周、第3周、第4周。甲组依次为10.5、11.75、9.25、12；乙组依次为8.5、9、10.25、11.5；丙组依次为7、7.5、8、8.75。`,
    type: 'bar', labels: ['第1周', '第2周', '第3周', '第4周'], unitPattern: /^(?:h|hour|hours|小时)$/i,
    labelPatterns: [/1|一/, /2|二/, /3|三/, /4|四/],
    series: [{ name: /甲/, values: [10.5, 11.75, 9.25, 12] }, { name: /乙/, values: [8.5, 9, 10.25, 11.5] }, { name: /丙/, values: [7, 7.5, 8, 8.75] }],
  },
  {
    id: 'all-missing',
    prompt: `${introduction}我想看一张三个月的折线图，但2026-01、2026-02、2026-03的读数全部缺失，没有任何数值。请判断现在是否有足够数据作图，不要推测、补零或编造测量值；如果不能画，请明确说明。`,
    type: null,
  },
];

/** Check correspondence, not just JSON syntax: preserve categories, series identity, gaps, signs and precision. */
export function assertChartCase(scenario, specs, answer) {
  if (!scenario.type) {
    assert.equal(specs.length, 0, 'All-missing input must not generate a chart');
    assert.match(answer, /缺失|不足|无法|不能|没有.*数值/, 'Explain why no chart can be drawn');
    return;
  }
  assert.equal(specs.length, 1, 'Expected one inline chart');
  const spec = specs[0];
  assert.equal(spec.type, scenario.type);
  assert.equal(spec.dataKind, 'example', 'Do not present supplied illustrative data as real');
  assert.match(spec.yAxis.unit, scenario.unitPattern, 'Preserve the measurement unit');
  assert.equal(spec.xAxis.values.length, scenario.labels.length);
  scenario.labelPatterns.forEach((pattern, i) => assert.match(spec.xAxis.values[i], pattern, `Category ${i} must preserve input order`));
  assert.equal(spec.series.length, scenario.series.length, 'Do not merge or drop series');
  for (const expected of scenario.series) {
    const matches = spec.series.filter(series => expected.name.test(series.name));
    assert.equal(matches.length, 1, 'Each input series must retain its identity');
    assert.deepEqual(matches[0].values, expected.values, 'Preserve every number, gap, sign and decimal');
  }
}
