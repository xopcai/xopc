import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, writeFileSync, realpathSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { parseArgs } from 'node:util';
import { attribution, validateJudgment } from './scoring.mjs';
const { values } = parseArgs({ options: { run: { type:'string' }, out: { type:'string' }, 'judge-retries': { type:'string' } } });
const run=realpathSync(resolve(values.run!)), out=resolve(values.out!);
if(existsSync(out)) throw new Error('Refusing existing revalidation output');
mkdirSync(out,{recursive:true});
const sha=(value:string|Buffer)=>createHash('sha256').update(value).digest('hex');
const read=(path:string)=>JSON.parse(readFileSync(path,'utf8'));
const original=read(join(run,'summary.json')), captureManifest=read(join(run,'manifest.json'));
const results:any[]=[], receipts:any[]=[], recovered:string[]=[], newErrors:string[]=[];
const retryRoot=values['judge-retries']?realpathSync(resolve(values['judge-retries'])):undefined;
const retries=retryRoot?read(join(retryRoot,'summary.json')).results:[];
for(const old of original.results){
 const row=structuredClone(old), dir=join(run,'cases',old.id);
 let rawPath=join(dir,'judge/raw.json');
 if(old.judgeSelected){
  const selected=realpathSync(resolve(old.judgeSelected));
  if(selected!==join(dir,'judge')&&!/^judge-service-retry-[12]$/.test(selected.slice(dir.length+1)))throw new Error('Invalid recorded service retry directory');
  if(!selected.startsWith(dir+'/'))throw new Error('Recorded judge belongs to another case');
  rawPath=join(selected,'raw.json');
 }
 const receipt:any={id:old.id,originalError:old.error??null};
 try{
  const retry=retries.find((r:any)=>r.id===old.id&&r.resolved);
  if(retry){
   const originalRaw=read(rawPath);
   if(old.judgment||!old.error||originalRaw.raw?.trim()||!/overload|rate.?limit|429|timed?\s*out|timeout|provider_error|502|503/i.test(originalRaw.error??''))throw new Error('Ineligible judge retry');
   if(retry.originalRawHash!==sha(readFileSync(rawPath))||retry.inputHash!==sha(readFileSync(join(dir,'judge-input.json')))||retry.captureHash!==sha(readFileSync(join(dir,'capture/result.json'))))throw new Error('Retry input provenance mismatch');
   const selected=realpathSync(resolve(retry.selected));
   if(!selected.startsWith(join(retryRoot!,'cases',old.id)+'/'))throw new Error('Retry output belongs to another case');
   receipt.originalRawJudgeHash=sha(readFileSync(rawPath));rawPath=join(selected,'raw.json');receipt.usedJudgeServiceRetry=true;
  }
  const raw=read(rawPath), input=read(join(dir,'judge-input.json')), captureBytes=readFileSync(join(dir,'capture/result.json'));
  if(retry&&raw.model!==captureManifest.models.judge)throw new Error('Retry judge model mismatch');
  const capture=JSON.parse(captureBytes.toString());
  if(raw.error || capture.error) throw new Error(raw.error??capture.error);
  if(input.answer!==capture.answer) throw new Error('Judge input differs from captured answer');
  receipt.captureHash=sha(captureBytes); receipt.rawJudgeHash=sha(readFileSync(rawPath));
  const judgment=validateJudgment(raw.raw,input);
  if(old.judgment && judgment.correct!==old.judgment.correct) throw new Error('Semantic verdict changed');
  row.judgment={...judgment,attribution:attribution(judgment,input),model:captureManifest.models.judge,
   durationMs:old.judgment?.durationMs??null};
  delete row.error;
  if(old.error) recovered.push(old.id);
  receipt.status=old.error?'recovered_original_validator_error':'revalidated_same_raw_verdict';
 }catch(error){
  row.error=old.error??String(error);
  delete row.judgment;
  receipt.status='retained_error'; receipt.validationError=String(error);
  if(!old.error)newErrors.push(old.id);
 }
 results.push(row);receipts.push(receipt);
}
const categories:Record<string,any>={}, stages:Record<string,number>={};
for(const row of results){
 const category=categories[`${row.suite}/${row.category}`]??={total:0,correct:0,errors:0};
 category.total++;category.correct+=row.judgment?.correct?1:0;category.errors+=row.error?1:0;
 const stage=row.error?'infrastructure_or_protocol_error':row.judgment.attribution;
 stages[stage]=(stages[stage]??0)+1;
}
writeFileSync(join(out,'summary.json'),JSON.stringify({scheduled:original.scheduled,completed:results.length,categories,stages,results,
 captureSourceChanged:original.sourceChanged,costUsd:null},null,2)+'\n');
writeFileSync(join(out,'manifest.json'),JSON.stringify({schemaVersion:3,modelCalls:0,candidateRegeneration:false,
 capturedManifestHash:sha(readFileSync(join(run,'manifest.json'))),originalSummaryHash:sha(readFileSync(join(run,'summary.json'))),
 validatorHash:sha(readFileSync(new URL('./scoring.mts',import.meta.url))),
 judgeRetries:retryRoot?{path:retryRoot,manifestHash:sha(readFileSync(join(retryRoot,'manifest.json')))}:null,
 protocol:'Revalidate saved raw judge outputs; optional first valid judgment after empty service error; no valid low grade resampling; decoded/encoded visible tool text accepted, metadata-only support rejected. Original records untouched.',
 recoveredOriginalJudgeErrors:recovered,newValidationErrors:newErrors,semanticVerdictsChanged:0,receipts},null,2)+'\n');
console.log(JSON.stringify({completed:results.length,recoveredOriginalJudgeErrors:recovered,newValidationErrors:newErrors}));
