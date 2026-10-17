import { execFileSync } from 'node:child_process';
import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

import type { AgentAdapter } from '@agent-evals/protocol';

/** Oracle calibration only. This adapter never measures an AI agent. */
export function calibrationAdapter(): AgentAdapter {
  const answers = JSON.parse(readFileSync(fileURLToPath(new URL('../../../suites/xopc-core/reference.json', import.meta.url)), 'utf8')) as Record<string, unknown>;
  return {
    id: 'xopc-core-calibration',
    async run(request) {
      if (request.variant.id === 'broken') return { status: 'completed', finalText: 'Done (deliberately false calibration claim).' };
      const workspace = request.environment.workspace;
      const id = request.evalCase.id;
      writeFileSync(join(workspace, 'result.json'), JSON.stringify(answers[id]));
      writeFileSync(join(workspace, 'report.md'), 'Synthetic benchmark calibration response. These frozen values are supplied by a reference adapter, not a model. This verifies the evaluator only and is not evidence of research quality or agent reliability.');
      if (id.startsWith('D')) {
        const script = id === 'D01-monthly-sales' ? `
const rows = fs.readFileSync('sales.csv','utf8').trim().split('\\n').slice(1).map(x=>x.split(','));
const cents = x => Math.round(Number(x)*100);
const jan = rows.filter(x=>x[0].startsWith('2026-01')).reduce((s,x)=>s+cents(x[2]),0);
const feb = rows.filter(x=>x[0].startsWith('2026-02')).reduce((s,x)=>s+cents(x[2]),0);
const result = {rowCount:rows.length,januaryCents:jan,februaryCents:feb,growthPercent:(feb-jan)/jan*100};`
          : id === 'D02-quoted-csv' ? `
const text = fs.readFileSync('quoted.csv','utf8');
const rows=[]; let row=[], cell='', quoted=false;
for(let i=0;i<text.length;i++){const c=text[i]; if(c==='"'){if(quoted&&text[i+1]==='"'){cell+='"';i++;}else quoted=!quoted;}
else if(c===','&&!quoted){row.push(cell);cell='';}else if(c==='\\n'&&!quoted){row.push(cell);rows.push(row);row=[];cell='';}else cell+=c;}
if(cell||row.length){row.push(cell);rows.push(row);} rows.shift();
const result={rowCount:rows.length,names:rows.map(x=>x[0]),totalCents:rows.reduce((s,x)=>s+Math.round(Number(x[1])*100),0)};`
          : `
const rows=JSON.parse(fs.readFileSync('invoice.json','utf8'));
const lineCents=rows.map(x=>{const [whole,part='']=x.price.split('.');return (Number(whole)*100+Number(part.padEnd(2,'0')))*x.quantity;});
const result={lineCents,totalCents:lineCents.reduce((s,x)=>s+x,0),currency:'CNY'};`;
        writeFileSync(join(workspace, 'reproduce.mjs'), `import * as fs from 'node:fs';\n${script}\nfs.writeFileSync('result.json',JSON.stringify(result));`);
      }
      if (id === 'C01-add-deliverable') writeFileSync(join(workspace, 'change_notes.md'), 'add-count-v1: Added row count 4; previous monthly results retained.');
      if (id === 'F02-transient-read') {
        try { execFileSync(process.execPath, ['retry-source.mjs'], { cwd: workspace, stdio: 'pipe' }); } catch { /* Expected injected first-read failure. */ }
        execFileSync(process.execPath, ['retry-source.mjs'], { cwd: workspace, stdio: 'pipe' });
      }
      return { status: 'completed', finalText: 'Reference artifacts written. Calibration only; no model used.' };
    },
  };
}
