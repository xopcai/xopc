import { createServer } from 'node:http';
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
  it('drains a canceled SDK stream and records final authoritative usage without delivering success', async () => {
    const controller = new AbortController();
    let physicalAborted = false;
    const encoder = new TextEncoder();
    const wire = cloudWireUsage({apiKey:'test', signal:controller.signal, fetch: (async (_input, init) => {
      init?.signal?.addEventListener('abort', () => { physicalAborted = true; });
      return new Response(new ReadableStream({start(destination) {
        destination.enqueue(encoder.encode('data: '+JSON.stringify({id:'wire',object:'chat.completion.chunk',choices:[{index:0,delta:{role:'assistant',content:'OK'},finish_reason:null}]})+'\n\n'));
        setTimeout(() => {
          destination.enqueue(encoder.encode('data: '+JSON.stringify({id:'wire',object:'chat.completion.chunk',choices:[{index:0,delta:{},finish_reason:'stop'}],usage:{prompt_tokens:10,completion_tokens:2,total_tokens:140}})+'\n\ndata: [DONE]\n\n'));
          destination.close();
        }, 40);
      }}), {headers:{'Content-Type':'text/event-stream'}});
    }) as typeof fetch});
    const stream = wire.wrap(streamSimple(model,normalizeContext(context),wire.options));
    for await (const event of stream) if (event.type === 'text_delta') controller.abort();
    const message = await stream.result();
    expect(message.stopReason).toBe('aborted');
    expect(message.usage).toMatchObject({input:10,output:2,totalTokens:140});
    expect(physicalAborted).toBe(false);
  });

  it('keeps a prefetched HTTP chunk from prematurely finishing a canceled tail', async () => {
    const frame = (delta: object, usage?: object) => 'data: '+JSON.stringify({id:'wire',object:'chat.completion.chunk',choices:[{index:0,delta,finish_reason:usage?'stop':null}],...(usage?{usage}:{})})+'\n\n';
    const server = createServer((_request, response) => {
      response.writeHead(200, {'Content-Type':'text/event-stream'});
      response.write(frame({role:'assistant',content:'first'}));
      setTimeout(() => response.write(frame({content:'second'})), 30);
      setTimeout(() => response.end(frame({}, {prompt_tokens:10,completion_tokens:2,total_tokens:140})+'data: [DONE]\n\n'), 70);
    });
    await new Promise<void>(resolve => server.listen(0,'127.0.0.1',resolve));
    try {
      const controller = new AbortController();
      const wire = cloudWireUsage({apiKey:'test',signal:controller.signal});
      const local = {...model,baseUrl:'http://127.0.0.1:'+ (server.address() as {port:number}).port+'/v1'};
      const stream = wire.wrap(streamSimple(local,normalizeContext(context),wire.options));
      for await (const event of stream) if(event.type==='text_delta') controller.abort();
      expect((await stream.result()).usage.totalTokens).toBe(140);
    } finally { server.closeAllConnections(); await new Promise<void>(resolve => server.close(()=>resolve())); }
  });

  it('bounds an unresponsive canceled transport and retains unknown usage', async () => {
    vi.useFakeTimers();
    try {
      const controller = new AbortController(); let physicalAborted = false;
      const wire = cloudWireUsage({fetch:(async (_input,init) => new Response(new ReadableStream({start(destination) {
        init?.signal?.addEventListener('abort',()=>{physicalAborted=true;destination.error(new Error('grace expired'));});
      }}))) as typeof fetch});
      const response = await wire.options.fetch!('https://example.invalid', {signal:controller.signal});
      controller.abort();
      const canceled = response.body!.cancel();
      await vi.advanceTimersByTimeAsync(14_999); expect(physicalAborted).toBe(false);
      await vi.advanceTimersByTimeAsync(1); await canceled; await wire.settle();
      expect(physicalAborted).toBe(true);
    } finally { vi.useRealTimers(); }
  });

});
