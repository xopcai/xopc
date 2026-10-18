import assert from 'node:assert/strict';import {mkdirSync,writeFileSync,cpSync} from 'node:fs';import {join,resolve} from 'node:path';
import {resolveApiKey} from '../../../../src/auth/credentials.ts';
// Authorization to renew OAuth credentials must come from the experiment owner.
const output=resolve(process.argv[2]);mkdirSync(output,{recursive:true});mkdirSync(join(output,'analysis-source'),{recursive:true});
const access=await resolveApiKey('xopc-cloud');assert.ok(access,'Cloud credentials unavailable');
const response=await fetch('https://router.xopc.ai/v1/models',{headers:{authorization:'Bearer '+access}});assert.ok(response.ok,'Model catalog HTTP '+response.status);
const catalog=await response.json(),model=catalog.data.find(m=>m.id==='openai-codex/gpt-5.6-sol');assert.ok(model,'Required exact Sol model unavailable');
writeFileSync(join(output,'model-discovery.json'),JSON.stringify({at:new Date().toISOString(),ref:'xopc-cloud/openai-codex/gpt-5.6-sol',liveModel:model,source:'Authenticated catalog; no inference request'},null,2));
cpSync(new URL('./shared-tool-exposure-fixture.patch',import.meta.url),join(output,'shared-tool-exposure-fixture.patch'));
console.log(JSON.stringify({model:model.id,output,credentialsArchived:false}));
