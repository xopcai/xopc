import { createHash } from 'node:crypto';
import { readFileSync, writeFileSync } from 'node:fs';

const digest = path => createHash('sha256').update(readFileSync(path)).digest('hex');
const inputBefore = digest('sales.csv');
const scriptBefore = digest(new URL(import.meta.url));

const totals = new Map();
for (const row of readFileSync('sales.csv', 'utf8').trim().split(/\r?\n/).slice(1)) {
  const [date, amount] = row.split(',');
  const month = date.slice(0, 7);
  totals.set(month, (totals.get(month) ?? 0) + Number(amount));
}
let previous;
const rows = [...totals].sort(([left], [right]) => left.localeCompare(right)).map(([month, total]) => {
  const percent = previous === undefined ? undefined : (total / previous - 1) * 100;
  const change = percent === undefined ? '' : `${percent >= 0 ? '+' : ''}${percent.toFixed(2)}`;
  previous = total;
  return [month, total, change];
});
writeFileSync('monthly_summary.csv', 'month,total,mom_pct\n' + rows.map(row => row.join(',')).join('\n') + '\n');

const pricing = readFileSync('pricing-sources.md', 'utf8');
const prices = [...pricing.matchAll(/Vendor ([AB]) ASR: ([\d.]+) CNY per hour\./g)];
const origins = new Map([...pricing.matchAll(/^Source ([AB]) (https:\/\/\S+)$/gm)].map(([, vendor, url]) => [vendor, url]));
if (prices.length !== 2 || !pricing.includes('TTS public price: not disclosed')) throw new Error('Unexpected pricing fixture');
const pricesTable = prices.map(([, vendor, amount]) =>
  `| ${vendor} | ${amount} | ${(Number(amount) / 60).toFixed(6)} | pricing-sources.md${origins.has(vendor) ? `，${origins.get(vendor)}` : ''} |`).join('\n');
const salesTable = rows.map(([month, total, change]) => `| ${month} | ${total} | ${change || '无上月'} |`).join('\n');
writeFileSync('report.md', [
  '# 月度销售及 ASR 价格', '', '数据来源为 sales.csv，按自然月汇总，环比以百分数表示。', '',
  '在含有原始输入的目录运行 `node reproduce.mjs`，即可重新生成本报告和汇总表。', '',
  '| 月份 | 销售总额 | 环比 % |', '| --- | ---: | ---: |', salesTable, '',
  '下表仅引用 pricing-sources.md 的虚构冻结测试资料，非实际报价。每分钟价格为每小时价格除以 60。', '',
  '| 供应商 | ASR 元/小时 | ASR 元/分钟 | 来源 |', '| --- | ---: | ---: | --- |', pricesTable, '',
  'pricing-sources.md 未公开 TTS 价格，完整通话成本无法计算。', '',
].join('\n'));
const inputAfter = digest('sales.csv');
const scriptAfter = digest(new URL(import.meta.url));
if (inputBefore !== inputAfter || scriptBefore !== scriptAfter) throw new Error('An original file changed during reproduction');
console.log(`sales.csv SHA-256 before=${inputBefore} after=${inputAfter}`);
console.log(`reproduce.mjs SHA-256 before=${scriptBefore} after=${scriptAfter}`);
console.log(`Verified ${rows.length} monthly rows and ${prices.length} frozen ASR prices.`);
