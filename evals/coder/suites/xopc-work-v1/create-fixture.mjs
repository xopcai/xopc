import {execFileSync} from 'node:child_process';
import {cpSync,mkdirSync,mkdtempSync,readdirSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';import {join,resolve} from 'node:path';import {fileURLToPath,pathToFileURL} from 'node:url';
export function createFixture(parent=tmpdir()) {
 mkdirSync(parent,{recursive:true});const repo=mkdtempSync(join(parent,'xopc-work-v1-'));
 const git=args=>execFileSync('git',args,{cwd:repo,encoding:'utf8',env:{...process.env,GIT_AUTHOR_DATE:'2026-10-18T00:00:00Z',GIT_COMMITTER_DATE:'2026-10-18T00:00:00Z'}}).trim();
 git(['init','-q','-b','fixture']);const caseCommits={};
 for(const id of ['W03','W05','W07','W08','W09','W12']){for(const p of readdirSync(repo))if(p!=='.git')rmSync(join(repo,p),{recursive:true,force:true});cpSync(fileURLToPath(new URL('./fixture/'+id+'/',import.meta.url)),repo,{recursive:true});git(['add','-A']);git(['-c','user.name=Xopc Benchmark','-c','user.email=eval@xopc.ai','commit','-qm','Work fixture '+id]);caseCommits[id]=git(['rev-parse','HEAD']);}
 return {repo,commit:caseCommits.W12,caseCommits};
}
if(process.argv[1]&&pathToFileURL(resolve(process.argv[1])).href===import.meta.url)console.log(JSON.stringify(createFixture(process.argv[2])));
