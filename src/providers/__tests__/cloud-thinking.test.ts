import { createServer } from 'node:http';
import { describe, it, expect } from 'vitest';
import { completeSimple, type Model, type Api } from '@earendil-works/pi-ai/compat';
import { cloudThinkingOverrides } from '../cloud-thinking.js';

it('maps only the verified endpoint and transmits off as disabled without invoking a real model', async () => {
  expect(cloudThinkingOverrides('xopc-cloud', 'auto')).toEqual({});
  expect(cloudThinkingOverrides('other', 'openai-codex/gpt-5.6-sol')).toEqual({});
  let body: any;
  const server = createServer(async (req, res) => {
    const chunks=[]; for await (const chunk of req) chunks.push(chunk);
    body=JSON.parse(Buffer.concat(chunks).toString());
    res.writeHead(200,{'content-type':'text/event-stream'});
    res.end('data: '+JSON.stringify({id:'synthetic',model:'openai-codex/gpt-5.6-sol',choices:[{index:0,delta:{content:'OK'},finish_reason:'stop'}],usage:{prompt_tokens:1,completion_tokens:1}})+'\n\ndata: [DONE]\n\n');
  });
  await new Promise<void>(resolve => server.listen(0,'127.0.0.1',resolve));
  try {
    const model = { id:'openai-codex/gpt-5.6-sol',provider:'xopc-cloud',name:'Fixture',api:'openai-completions',reasoning:true,
      baseUrl:`http://127.0.0.1:${(server.address() as any).port}`,input:['text'],contextWindow:128000,maxTokens:1000,
      cost:{input:0,output:0,cacheRead:0,cacheWrite:0},...cloudThinkingOverrides('xopc-cloud','openai-codex/gpt-5.6-sol') } as Model<Api>;
    const result=await completeSimple(model,{messages:[{role:'user',content:'synthetic',timestamp:1}]},{reasoning:'off',apiKey:'fixture'});
    expect(result.stopReason).toBe('stop');
    expect(body.thinking).toEqual({ type: 'disabled' });
    expect(body.reasoning_effort).toBeUndefined();
    expect(body.model).toBe('openai-codex/gpt-5.6-sol');
  } finally { await new Promise<void>(resolve => server.close(()=>resolve())); }
});
