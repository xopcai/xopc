import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { parseArgs } from 'node:util';
import { scoreEpisode } from './score-episodes.mjs';
const { values } = parseArgs({ options: { run: { type: 'string' }, fixtures: { type: 'string' }, out: { type: 'string' } } });
if (!values.run || !values.fixtures || !values.out) throw new Error('Specify --run, --fixtures and --out');
const run = resolve(values.run), out = resolve(values.out), fixtures = resolve(values.fixtures);
if (existsSync(out)) throw new Error('Refusing existing revalidation output');
if (!existsSync(join(run,'completion.json'))) throw new Error('Wait for capture completion');
const manifest = JSON.parse(readFileSync(join(run,'manifest.json'),'utf8'));
if (!(manifest.protocolVersion >= 4)) throw new Error('This capture predates learning-reliability witnesses; use its frozen validator instead of treating missing witnesses as product failures');
mkdirSync(out,{recursive:true});
const hash = (path: string | URL) => createHash('sha256').update(readFileSync(path)).digest('hex');
const selection = JSON.parse(readFileSync(join(fixtures,'selection.json'),'utf8'));
if (hash(join(fixtures,'selection.json')) !== manifest.selectionHash) throw new Error('Fixture selection differs from capture');
const results = manifest.cases.map((item: any) => {
  const fixture = join(fixtures,item.id+'.json');
  if (hash(fixture) !== item.sha256) throw new Error('Fixture differs from capture');
  const gold = JSON.parse(readFileSync(fixture,'utf8')).gold.episode;
  if (!gold) throw new Error('Not an episode fixture');
  const capture = join(run,'cases',item.id,'capture');
  try { return { id: item.id, ...scoreEpisode(gold,capture), captureHash: hash(join(capture,'result.json')) }; }
  catch (error) { return { id:item.id,passed:false,error:String(error) }; }
});
writeFileSync(join(out,'summary.json'),JSON.stringify({completed:results.length,passed:results.filter((row: any) => row.passed).length,results},null,2)+'\n');
writeFileSync(join(out,'manifest.json'),JSON.stringify({modelCalls:0,candidateRegeneration:false,validatorVersion:3,capturedProtocolVersion:manifest.protocolVersion,validatorHash:hash(new URL('./score-episodes.mts',import.meta.url)),
  capturedManifestHash:hash(join(run,'manifest.json')),selectionHash:hash(join(fixtures,'selection.json')),caseCount:selection.cases.length,
  protocol:'Read-only deterministic checkpoint revalidation; original captures and scores are retained.'},null,2)+'\n');
