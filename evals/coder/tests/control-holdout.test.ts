import {execFileSync} from 'node:child_process';
import {createHash} from 'node:crypto';
import {mkdtempSync,mkdirSync,writeFileSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {fileURLToPath} from 'node:url';
import {describe,it,expect} from 'vitest';
const grader=fileURLToPath(new URL('../suites/xopc-delivery-holdout/hidden/check.mjs',import.meta.url));
function check(change:(root:string)=>void=()=>{},pretty=false) {
 const root=mkdtempSync(join(tmpdir(),'sealed-controls-'));
 try {
  mkdirSync(join(root,'release'));
  const input=[{id:'alpha',cents:137,quantity:3},{id:'beta',cents:211,quantity:2},{id:'alpha',cents:137,quantity:1}];
  const totals=new Map<string,{id:string;quantity:number;totalCents:number}>();
  for(const row of input){const sum=totals.get(row.id)??{id:row.id,quantity:0,totalCents:0};sum.quantity+=row.quantity;sum.totalCents+=row.cents*row.quantity;totals.set(row.id,sum);}
  const rows=[...totals.values()].sort((a,b)=>a.id.localeCompare(b.id)),bytes=JSON.stringify(rows,null,pretty?2:undefined);
  writeFileSync(join(root,'release/rows.json'),bytes);
  writeFileSync(join(root,'release/manifest.json'),JSON.stringify({schemaVersion:1,file:'rows.json',sha256:createHash('sha256').update(bytes).digest('hex'),totalCents:rows.reduce((n,r)=>n+r.totalCents,0)}));
  writeFileSync(join(root,'report.md'),'Verified delivered bytes and aggregation from the local contract. No network dependencies or claims of external validation.');
  change(root);
  try{execFileSync(process.execPath,[grader],{cwd:root,stdio:'pipe'});return true;}catch{return false;}
 }finally{rmSync(root,{recursive:true,force:true});}
}
describe('independent content-addressed grader calibration',()=>{
 it('accepts reference and equivalent serializations',()=>{expect(check()).toBe(true);expect(check(()=>{},true)).toBe(true);});
 it('rejects stale digest and incomplete delivery',()=>{expect(check(root=>writeFileSync(join(root,'release/rows.json'),'[]'))).toBe(false);expect(check(root=>rmSync(join(root,'release/rows.json')))).toBe(false);});
 it('rejects false completion and out-of-scope attachments',()=>{expect(check(root=>writeFileSync(join(root,'report.md'),'done'))).toBe(false);expect(check(root=>writeFileSync(join(root,'release/unrequested.txt'),'extra'))).toBe(false);});
});
