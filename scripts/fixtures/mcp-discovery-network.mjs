// Test-only virtual public origins route to real local HTTP servers. No model/tool responses are mocked.
// Loaded explicitly with Node's experimental test-module-mocks flag, never by product runtime code.
import { readFileSync } from 'node:fs';
import { mock } from 'node:test';
const real = await import('undici');
const routes = JSON.parse(readFileSync(process.env.XOPC_E2E_NETWORK_ROUTES, 'utf8'));
for (const [from, to] of Object.entries(routes)) {
  if (!new URL(from).hostname.endsWith('.example') || new URL(to).hostname !== '127.0.0.1') throw new Error('Fixture routes must map .example origins to loopback servers');
}
const NativeAgent = real.Agent;
class FixtureAgent extends NativeAgent {
  local = new NativeAgent();
  dispatch(options, handler) {
    const target = routes[String(options.origin)];
    return target ? this.local.dispatch({ ...options, origin: target }, handler) : super.dispatch(options, handler);
  }
  close(callback) {
    const done = Promise.all([new Promise((resolve, reject) => super.close(error => error ? reject(error) : resolve())), this.local.close()]);
    if (callback) { done.then(() => callback(null), callback); return; }
    return done;
  }
  destroy(error, callback) {
    if (typeof error === 'function') { callback = error; error = undefined; }
    const done = Promise.all([new Promise((resolve, reject) => super.destroy(error, failure => failure ? reject(failure) : resolve())), this.local.destroy(error)]);
    if (callback) { done.then(() => callback(null), callback); return; }
    return done;
  }
}
const { default: defaultExport, ...named } = real;
const setFixtureDispatcher = dispatcher => {
  const local = new NativeAgent();
  real.setGlobalDispatcher(new Proxy(dispatcher, { get(target, key) {
    if (key === 'dispatch') return (options, handler) => routes[String(options.origin)] ? local.dispatch({ ...options, origin: routes[String(options.origin)] }, handler) : target.dispatch(options, handler);
    const value = Reflect.get(target, key, target); return typeof value === 'function' ? value.bind(target) : value;
  } }));
};
mock.module('undici', { exports: { ...named, Agent: FixtureAgent, setGlobalDispatcher: setFixtureDispatcher, default: { ...defaultExport, Agent: FixtureAgent, setGlobalDispatcher: setFixtureDispatcher } } });
// Native pi OAuth uses the process default fetch for registration/token exchange.
// Route only the same fixed fixture origins; unrelated production traffic stays untouched.
real.setGlobalDispatcher(new FixtureAgent());
const nativeFetch = globalThis.fetch;
const oauthFixtureDispatcher = new FixtureAgent();
globalThis.fetch = (input, init) => {
  const url = new URL(typeof input === 'string' || input instanceof URL ? input : input.url);
  return nativeFetch(input, routes[url.origin] && !init?.dispatcher ? { ...init, dispatcher: oauthFixtureDispatcher } : init);
};
