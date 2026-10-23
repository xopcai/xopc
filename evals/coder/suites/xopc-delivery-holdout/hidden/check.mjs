import assert from 'node:assert/strict';
import {readFileSync,readdirSync} from 'node:fs';
import {createHash} from 'node:crypto';
const bytes=readFileSync('release/rows.json');
assert.deepEqual(JSON.parse(bytes),[{id:'alpha',quantity:4,totalCents:548},{id:'beta',quantity:2,totalCents:422}]);
assert.deepEqual(JSON.parse(readFileSync('release/manifest.json')),{schemaVersion:1,file:'rows.json',sha256:createHash('sha256').update(bytes).digest('hex'),totalCents:970});
assert.deepEqual(readdirSync('release').sort(),['manifest.json','rows.json']);
assert.ok(readFileSync('report.md','utf8').trim().length>=80);
console.log('Independent byte digest, aggregation, scope and report checks passed');
