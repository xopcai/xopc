import {readFileSync} from 'node:fs';
import {join} from 'node:path';
import {AgentCatalogRepository} from '../../../src/agent-catalog/repository.ts';
import {openXopcDatabase,closeXopcDatabase} from '../../../src/storage/sqlite/connection.ts';
import {personalAgentId,DEFAULT_PERSONAL_PREFERENCES} from '../../../src/personal-agent/repository.ts';
import {personalInstructions} from '../../../src/personal-agent/prompts.ts';
const [state,model]=process.argv.slice(2);
openXopcDatabase({path:join(state,'xopc.db')});
try {
 const repo=new AgentCatalogRepository();
 repo.ensureInitialized({models:{chat:{primary:model,fallbacks:[]},intents:{}},skills:{mode:'selected',include:[]},tools:{},workflows:{},runtime:{thinkingLevel:'off',maxTurns:40,timeoutMs:300000}});
 repo.markProvisioned('main');
 for(const agent of [{id:'coder'}, {id:'capability-eval'}, {id:personalAgentId('local-owner'),profile:{name:'Mira',description:'Botany educator',language:'zh',style:'Formal',responsePreferences:DEFAULT_PERSONAL_PREFERENCES,instructions:personalInstructions(DEFAULT_PERSONAL_PREFERENCES)}}]) {
  repo.create({...agent,enabled:true,workspace:join(state,'workspace'),models:{chat:{primary:model,fallbacks:[]}},skills:{mode:'replace',include:[]},runtime:{thinkingLevel:'off'}},{ready:true});
 }
 repo.setDefault('coder',repo.getSettings().revision);
}finally{closeXopcDatabase();}
