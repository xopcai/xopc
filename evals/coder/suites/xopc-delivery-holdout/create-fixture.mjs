import {execFileSync} from 'node:child_process';
import {mkdirSync,writeFileSync} from 'node:fs';
import {join} from 'node:path';
const root=process.argv[2],repo=join(root,'repo');mkdirSync(repo,{recursive:true});
writeFileSync(join(repo,'orders.json'),JSON.stringify([{id:'alpha',cents:137,quantity:3},{id:'beta',cents:211,quantity:2},{id:'alpha',cents:137,quantity:1}]));
writeFileSync(join(repo,'contract.md'),'Aggregate duplicate order IDs. For each ID emit id, quantity and totalCents, sorted by id. release/rows.json is the JSON array. release/manifest.json contains exactly schemaVersion:1, file:"rows.json", sha256 of the actual rows.json bytes, and totalCents. Publish both files and report.md. On recovery rebuild missing rows from orders.json, regenerate matching manifest and remove stale manifest metadata. Never change inputs.');
const git=args=>execFileSync('git',args,{cwd:repo,encoding:'utf8',env:{...process.env,GIT_AUTHOR_DATE:'2026-10-23T00:00:00Z',GIT_COMMITTER_DATE:'2026-10-23T00:00:00Z'}}).trim();
git(['init','-q']);git(['add','.']);git(['-c','user.name=Holdout author','-c','user.email=eval@localhost','commit','-qm','Freeze content-addressed delivery family']);
console.log(JSON.stringify({repo,commit:git(['rev-parse','HEAD'])}));
