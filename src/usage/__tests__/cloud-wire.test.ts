import { completeSimple, streamSimple, normalizeContext, type Model, type Api } from '@earendil-works/pi-ai/compat';
import { describe, expect, it, vi } from 'vitest';

import { cloudWireUsage } from '../cloud-wire.js';

const model = { provider:'openai',id:'wire-test',name:'Wire test',api:'openai-completions',baseUrl:'https://example.invalid/v1',
  reasoning:false,input:['text'],contextWindow:32000,maxTokens:1000,cost:{input:0,output:0,cacheRead:0,cacheWrite:0} } as Model<Api>;
const context = {messages:[{role:'user' as const,content:'Reply OK',timestamp:1}]};
function response(usage: object) {
  return new Response('data: '+JSON.stringify({id:'wire',object:'chat.completion.chunk',model:'wire-test',choices:[{index:0,delta:{role:'assistant',content:'OK'},finish_reason:null}]})+'\n\n'+
    'data: '+JSON.stringify({id:'wire',object:'chat.completion.chunk',model:'wire-test',choices:[{index:0,delta:{},finish_reason:'stop'}],usage})+'\n\ndata: [DONE]\n\n', {headers:{'Content-Type':'text/event-stream'}});
}
describe('Cloud authoritative usage',()=>{
  it('preserves total_tokens even when compatible prompt/output components omit tokens',async()=>{
    const transport=vi.fn(async()=>response({prompt_tokens:716,completion_tokens:96,total_tokens:7852}));
    const wire=cloudWireUsage({apiKey:'test',fetch:transport as typeof fetch});
    const message=await completeSimple(model,context,wire.options);
    expect(message.usage.totalTokens).toBe(812);
    expect(wire.apply(message).usage).toMatchObject({input:716,output:96,totalTokens:7852});
    expect(transport).toHaveBeenCalledOnce();
  });
  it('patches terminal events and result before agent consumers observe usage',async()=>{
    const wire=cloudWireUsage({apiKey:'test',fetch:(async()=>response({prompt_tokens:10,completion_tokens:2,total_tokens:140})) as typeof fetch});
    const stream=wire.wrap(streamSimple(model,normalizeContext(context),wire.options));
    const events=[];for await(const e of stream)events.push(e);
    const done=events.find(e=>e.type==='done');
    expect(done?.type==='done'&&done.message.usage.totalTokens).toBe(140);
    expect((await stream.result()).usage.totalTokens).toBe(140);
  });
  it('does not carry a previous response total into a response with missing authoritative usage',async()=>{
    let n=0;const wire=cloudWireUsage({apiKey:'test',fetch:(async()=>response(++n===1?{prompt_tokens:10,completion_tokens:2,total_tokens:140}:{prompt_tokens:3,completion_tokens:1})) as typeof fetch});
    expect(wire.apply(await completeSimple(model,context,wire.options)).usage.totalTokens).toBe(140);
    expect(wire.apply(await completeSimple(model,context,wire.options)).usage.totalTokens).toBe(4);
  });
});
