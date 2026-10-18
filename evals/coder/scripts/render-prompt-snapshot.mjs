import {mkdirSync,writeFileSync} from 'node:fs';
import {resolve,join} from 'node:path';
import {pathToFileURL} from 'node:url';
import {createHash} from 'node:crypto';
const root=process.cwd(),output=resolve(process.argv[2]);
const {buildSystemPrompt}=await import(pathToFileURL(join(root,'src/agent/prompt/system-prompt.ts')));
const {personalInstructions}=await import(pathToFileURL(join(root,'src/personal-agent/prompts.ts')));
const prefs={warmth:'balanced',humor:'occasional',supportMode:'untangle',detailLevel:'brief',proactivity:'decisions'};
const personal=personalInstructions(prefs);
mkdirSync(output,{recursive:true});writeFileSync(join(output,'personal-instructions.txt'),personal);
const toolSets={none:[],read:['read_file'],list:['skills_list'],view:['skill_view'],publish:['publish_artifacts'],limited:['read_file','write_file','apply_patch'],full:['read_file','write_file','apply_patch','exec_command','review_workspace','session_status','publish_artifacts']};
const manifest=[];
for(const [set,tools] of Object.entries(toolSets))for(const role of ['executor','personal'])for(const model of ['deepseek/deepseek-flash','minimax-cn/MiniMax-M2.7']) {
 const args={promptMode:'full',promptRole:role,toolNames:tools,channels:['cli','webchat'],userTimezone:'UTC',agentId:role==='personal'?'personal-eval':'coder',runtime:{version:'frozen-runtime',model,thinkingLevel:'off'},agentProfile:{name:'Mira',description:'Botany educator',language:'zh',style:'Formal'},...(role==='personal'?{customInstructions:personal}:{})};
 const prompt=buildSystemPrompt('/workspace/eval',args),name=`${role}-${set}-${model.split('/')[0]}.txt`;
 writeFileSync(join(output,name),prompt);manifest.push({name,args,chars:prompt.length,sha256:createHash('sha256').update(prompt).digest('hex')});
}
writeFileSync(join(output,'generated.json'),JSON.stringify(manifest,null,2)+'\n');
console.log(JSON.stringify({snapshots:manifest.length,personalChars:personal.length}));
