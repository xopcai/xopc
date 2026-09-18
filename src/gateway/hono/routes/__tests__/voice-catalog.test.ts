import { serve } from '@hono/node-server';
import { Hono } from 'hono';
import { afterEach, expect, it } from 'vitest';
import { ConfigSchema } from '../../../../config/schema.js';
import { getModelCatalogStore, resetModelCatalogStore } from '../../../../providers/model-catalog-store.js';
import { voiceFixture } from '../../../../voice/__tests__/voice-fixture.js';
import { auth } from '../../middleware/auth.js';
import { registerAuthenticatedLazyRouteFallback, resetLazyRouteBundlesForTests } from '../lazy-fallback.js';

afterEach(() => {resetLazyRouteBundlesForTests();resetModelCatalogStore();});
it('serves authenticated voice discovery and revision-checked selections through real lazy HTTP routing', async () => {
  getModelCatalogStore().saveSource('xopc-cloud',{providerId:'xopc-cloud',baseUrl:'https://example.test/v1',api:'openai-completions',etag:'3',recommendedModel:null,lastSuccessAt:1,models:[{id:'new-vendor',name:'New vendor',kind:'omni',availability:'available',input:['audio'],output:['audio'],operations:['audio.conversation'],contextWindow:128000,maxOutputTokens:null,reasoning:false,voice:voiceFixture(['conversation'])}]});
  const service = {getModelCatalogSync: () => ({refreshNow: async () => ({state:'stale',error:{message:'offline'}})}),currentConfig:ConfigSchema.parse({}),saveConfig:async (config: ReturnType<typeof ConfigSchema.parse>) => {service.currentConfig = config; return {saved:true};}};
  const app = new Hono();
  app.use(auth({getResolvedAuth:() => ({mode:'token',token:'test-token',allowTailscale:false})}));
  registerAuthenticatedLazyRouteFallback(app,{service,strictRateLimitMiddleware:async (_c,next) => next()} as never);
  const server = serve({fetch:app.fetch,port:0});
  if (!server.listening) await new Promise<void>(resolve => server.once('listening',resolve));
  const url = `http://127.0.0.1:${(server.address() as {port:number}).port}`;
  const headers = {authorization:'Bearer test-token','content-type':'application/json'};
  try {
    expect((await fetch(`${url}/api/voice/catalog`)).status).toBe(401);
    expect((await fetch(`${url}/api/voice/catalog/refresh`,{method:'POST',headers})).status).toBe(503);
    const catalog = await (await fetch(`${url}/api/voice/catalog`,{headers})).json();
    expect(catalog.payload.models[0].id).toBe('new-vendor');
    const selection = {mode:'conversation',model:'new-vendor',voice:'voice-a'};
    const update = await fetch(`${url}/api/voice/selection`,{method:'PUT',headers,body:JSON.stringify({revision:catalog.payload.revision,selection})});
    expect(update.status).toBe(200);
    expect((await update.json()).payload.selections).toEqual([selection]);
    expect((await fetch(`${url}/api/voice/selection`,{method:'PUT',headers,body:JSON.stringify({revision:catalog.payload.revision,selection})})).status).toBe(409);
    expect((await fetch(`${url}/api/voice/selection`,{method:'PUT',headers:{'content-type':'application/json'},body:JSON.stringify({revision:catalog.payload.revision,selection})})).status).toBe(401);
  } finally { server.closeAllConnections(); await new Promise<void>(resolve => server.close(() => resolve())); }
});
