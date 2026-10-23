import assert from'node:assert/strict';import{readFileSync,readdirSync}from'node:fs';
const lines=readFileSync('ledger.jsonl','utf8').split('\n'),ids=new Set(),totals={};let complete=0,tail=false;
for(const [i,line]of lines.entries()){let row;try{row=JSON.parse(line);}catch{assert.equal(i,lines.length-1);tail=true;continue;}complete++;if(ids.has(row.id))continue;ids.add(row.id);totals[row.account]=(totals[row.account]??0)+row.deltaCents;}
assert.deepEqual(JSON.parse(readFileSync('out/totals.json')),totals);assert.deepEqual(JSON.parse(readFileSync('out/checkpoint.json')),{appliedIds:[...ids],completeLines:complete,incompleteTail:tail});
assert.deepEqual(readdirSync('out').sort(),['checkpoint.json','totals.json']);assert.ok(readFileSync('report.md','utf8').trim().length>=80);console.log('Independent replay, duplicate, incomplete-tail and output-scope checks passed');
