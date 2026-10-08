import { AsyncLocalStorage } from 'node:async_hooks';

import { context, trace, createContextKey, SpanStatusCode, type Context, type Span, type Attributes } from '@opentelemetry/api';
import { AsyncLocalStorageContextManager } from '@opentelemetry/context-async-hooks';
import { BasicTracerProvider, type ReadableSpan, type SpanProcessor } from '@opentelemetry/sdk-trace-base';

import { CredentialResolver } from '../auth/credentials.js';
import { createLogger } from '../utils/logger.js';
import { runWithLogContext } from '../utils/logger/context.js';
import { TracingConfigSchema, defaultTracingConfig, type TracingConfig } from './config.js';
import { LangfuseTarget } from './langfuse.js';
import { LocalTraceStore } from './store.js';
import { boundedJson, redactString } from './sanitize.js';
import type { TraceRecord } from './types.js';

const log = createLogger('Observability');
let lastStorageWarning = 0;
function storageWarning(message: string) {
  if (Date.now() - lastStorageWarning < 60000) return;
  lastStorageWarning = Date.now(); log.warn({ errorMessage: message, phase: 'local_trace_write' }, `Local trace recording unavailable: ${message}`);
}

export type TraceIdentity = { conversationId?: string; runId?: string; agentId?: string; transcriptId?: string };
type Scope = { config: TracingConfig; target?: LangfuseTarget; identity: TraceIdentity; name: string; count: number; bytes: number; root?: Span; epoch?: Promise<number> };
const localEpochKey = createContextKey('xopc.trace.localEpoch');
const scopes = new AsyncLocalStorage<Scope>();
let config = defaultTracingConfig();
let store: LocalTraceStore | undefined;
let target: LangfuseTarget | undefined;
let provider: BasicTracerProvider | undefined;
let revision = 0;
let active = 0;
let dropped = 0;
const pendingLocal = new Set<Promise<void>>();
let pendingLocalBytes = 0;
let remoteState = 'disabled';
let knownSecrets: string[] = [];
let configureVersion = 0;
let targetSignature = '';
const targets = new WeakMap<ReadableSpan, LangfuseTarget>();
const localEpochs = new WeakMap<ReadableSpan, Promise<number>>();
const captured = new WeakMap<ReadableSpan, boolean>();

function secretSafe(value: string): string {
  let result = redactString(value);
  for (const secret of knownSecrets) if (secret.length >= 4) result = result.split(secret).join('[REDACTED]');
  return result;
}
function record(span: ReadableSpan, ended = true): TraceRecord {
  const attrs: TraceRecord['attributes'] = {};
  for (const [key, value] of Object.entries(span.attributes)) if (['string', 'number', 'boolean'].includes(typeof value)) attrs[key] = typeof value === 'string' ? secretSafe(value) : value as number | boolean;
  return {
    traceId: span.spanContext().traceId, spanId: span.spanContext().spanId,
    parentSpanId: span.parentSpanContext?.spanId, name: secretSafe(span.name),
    type: String(attrs['langfuse.observation.type'] ?? 'span') as TraceRecord['type'],
    startedAt: Math.floor(span.startTime[0] * 1000 + span.startTime[1] / 1000000),
    ...(ended ? { endedAt: Math.floor(span.endTime[0] * 1000 + span.endTime[1] / 1000000) } : {}),
    status: ended ? String(attrs['xopc.status'] ?? (span.status.code === SpanStatusCode.ERROR ? 'error' : 'success')) : 'running', attributes: attrs,
  };
}
class TraceProcessor implements SpanProcessor {
  onStart(span: ReadableSpan, parentContext: Context): void {
    const scope = scopes.getStore();
    if (!(scope?.config ?? config).enabled) return;
    captured.set(span, true);
    if (scope?.target ?? target) targets.set(span, (scope?.target ?? target)!);
    if (!span.parentSpanContext || span.attributes['xopc.localRoot'] === true) {
      const epoch = localStore().begin(record(span, false)).catch(() => { storageWarning('Trace root could not be persisted'); return -1; });
      localEpochs.set(span, epoch);
      if (scope) scope.epoch = epoch;
    } else {
      const epoch = scope?.epoch ?? parentContext.getValue(localEpochKey) as Promise<number> | undefined;
      if (epoch) localEpochs.set(span, epoch);
    }
  }
  onEnd(span: ReadableSpan): void {
    if (!captured.has(span)) return;
    try {
      const value = record(span);
      const bytes = Buffer.byteLength(JSON.stringify(value));
      if (pendingLocal.size < 2000 && pendingLocalBytes + bytes <= 8 * 1048576) {
        const destination = localStore();
        pendingLocalBytes += bytes;
        const pending = (localEpochs.get(span) ?? Promise.resolve(undefined))
          .then(async epoch => { await destination.write(value, epoch); if (destination.lastError) storageWarning(destination.lastError); })
          .catch(() => { dropped++; })
          .finally(() => { pendingLocal.delete(pending); pendingLocalBytes -= bytes; });
        pendingLocal.add(pending);
      } else dropped++;
      targets.get(span)?.enqueue(value);
    } catch { dropped++; }

  }
  async forceFlush(): Promise<void> { await Promise.allSettled([...pendingLocal]); await Promise.allSettled([store?.flush(), target?.flush()]); }
  async shutdown(): Promise<void> { await this.forceFlush(); target?.close(); await store?.close(); }
}
function tracer() {
  if (!provider) {
    context.setGlobalContextManager(new AsyncLocalStorageContextManager().enable());
    process.once('beforeExit', () => { void flushTracing(); });
    provider = new BasicTracerProvider({ spanProcessors: [new TraceProcessor()], spanLimits: { attributeCountLimit: 64, attributeValueLengthLimit: 65536, eventCountLimit: 0 } });
  }
  return provider.getTracer('xopc.observability');
}
export function localStore(): LocalTraceStore { return store ??= new LocalTraceStore(config); }
export function tracingConfig(): TracingConfig { return structuredClone(config); }
export async function configureTracing(value?: unknown): Promise<void> {
  const version = ++configureVersion;
  const next = TracingConfigSchema.parse(value ?? {});
  config = next; revision++;
  if (store) await store.request('configure', config).catch(() => {});
  remoteState = !next.enabled || !next.langfuse.enabled ? 'disabled' : 'missing_credentials';
  if (remoteState === 'disabled') { target?.close(); target = undefined; targetSignature = ''; return; }
  try {
    const secretKey = process.env.LANGFUSE_SECRET_KEY || await new CredentialResolver().revealGatewayStoredApiKey('langfuse');
    const publicKey = process.env.LANGFUSE_PUBLIC_KEY || await new CredentialResolver().revealGatewayStoredApiKey('langfuse-public');
    if (version !== configureVersion) return;
    if (secretKey && publicKey) {
      const baseUrl = process.env.LANGFUSE_BASE_URL || next.langfuse.baseUrl;
      const signature = JSON.stringify([baseUrl, publicKey, secretKey]);
      knownSecrets = [...new Set([...knownSecrets, secretKey, publicKey])].slice(-64);
      if (!target || signature !== targetSignature) { target?.close(); target = new LangfuseTarget(baseUrl, publicKey, secretKey); targetSignature = signature; }
      remoteState = 'ready';
    } else { target?.close(); target = undefined; targetSignature = ''; }
  } catch { remoteState = 'missing_credentials'; target?.close(); target = undefined; targetSignature = ''; }
}
export async function tracingStatus() {
  const local = await localStore().request('status').catch(() => ({ unavailable: true }));
  return { local: { ...local, pending: pendingLocal.size, pendingBytes: pendingLocalBytes, queueDropped: localStore().dropped, lastError: localStore().lastError }, langfuse: target?.status() ?? { state: remoteState, pending: 0, dropped: 0 }, active, dropped };
}
export function traceIds(): { traceId?: string; spanId?: string } {
  const current = trace.getSpan(context.active())?.spanContext();
  return current ? { traceId: current.traceId, spanId: current.spanId } : {};
}
function attrs(identity: TraceIdentity, type: string): Attributes {
  const result: Attributes = { ...(type === 'agent' ? { 'xopc.localRoot': true } : {}), 'langfuse.observation.type': type, 'xopc.configRevision': revision };
  for (const [key, value] of Object.entries(identity)) if (value) { result[`xopc.${key}`] = value; result[`langfuse.trace.metadata.${key}`] = value; }
  if (scopes.getStore()?.name) result['langfuse.trace.name'] = scopes.getStore()!.name;
  if (identity.conversationId) result['langfuse.session.id'] = identity.conversationId;
  return result;
}
export type Observation = { span?: Span; run: <T>(fn: () => T) => T; finish: (status?: string, output?: unknown) => void; input: (value: unknown) => void; update: (values: Attributes) => void };
export function startObservation(name: string, type: TraceRecord['type'], identity: TraceIdentity = {}): Observation {
  const scope = scopes.getStore();
  if (!(scope?.config ?? config).enabled || (scope && ++scope.count > 1000)) { if (scope?.count > 1000) scope.root?.setAttribute('xopc.partialReason', 'span_quota'); dropped++; return { run: fn => fn(), finish() {}, input() {}, update() {} }; }
  const standalone = !scope;
  if (standalone && active >= 256) { dropped++; return { run: fn => fn(), finish() {}, input() {}, update() {} }; }
  if (standalone) active++;
  const span = tracer().startSpan(name.slice(0, 120), { attributes: attrs({ ...scope?.identity, ...identity }, type) });
  const spanContext = trace.setSpan(context.active(), span).setValue(localEpochKey, localEpochs.get(span as unknown as ReadableSpan) ?? context.active().getValue(localEpochKey));
  let ended = false;
  const put = (key: string, value: unknown) => {
    const policy = scope?.config ?? config;
    if (policy.capture === 'metadata') return;
    const max = policy.capture === 'detailed' && (policy.detailedUntil ?? 0) > Date.now() ? 65536 : 8192;
    const json = secretSafe(boundedJson(value, max));
    if (scope && (scope.bytes += Buffer.byteLength(json)) > policy.local.maxTraceKiB * 1024) { span.setAttribute('xopc.partialReason', 'capture_quota'); return; }
    span.setAttribute(key, json);
  };
  return {
    span,
    run: fn => context.with(spanContext, () => runWithLogContext({ ...identity, ...traceIds() }, fn)),
    input: value => put('langfuse.observation.input', value),
    update: values => { for (const [key, value] of Object.entries(values)) if (value !== undefined) span.setAttribute(key, typeof value === 'string' ? secretSafe(value.slice(0, 1024)) : value); },
    finish(status = 'success', output) {
      if (ended) return; ended = true; if (standalone) active--;
      if (output !== undefined) put('langfuse.observation.output', output);
      span.setAttribute('xopc.status', status);
      span.setStatus({ code: status === 'error' ? SpanStatusCode.ERROR : SpanStatusCode.OK }); span.end();
    },
  };
}
export async function traceRun<T extends { ok?: boolean; stopReason?: string; errorMessage?: string; lastAssistantText?: string }>(name: string, identity: TraceIdentity, fn: () => Promise<T>, input?: unknown): Promise<T> {
  if (scopes.getStore() || !config.enabled) return fn();
  if (active >= 256) { dropped++; return scopes.run({ config: { ...config, enabled: false }, identity, name, count: 0, bytes: 0 }, fn); }
  active++;
  const scope: Scope = { config: structuredClone(config), target, identity, name, count: 0, bytes: 0 };
  try {
    return await scopes.run(scope, async () => {
      const observation = startObservation(name, 'agent', identity); scope.root = observation.span; observation.input(input);
      try { const result = await observation.run(fn); observation.finish(result.stopReason ? 'suspended' : result.ok === false ? result.errorMessage === 'aborted' ? 'cancelled' : 'error' : 'success', result.lastAssistantText ?? result.errorMessage); return result; }
      catch (error) { observation.finish('error', error instanceof Error ? error.message : String(error)); throw error; }
    });
  } finally { active--; }
}
const tracedExecutions = new WeakSet<Function>();
export function traceTools<T extends { name: string; execute: (...args: any[]) => any }>(tools: T[]): T[] {
  return tools.map(tool => {
    if (tracedExecutions.has(tool.execute)) return tool;
    const execute = (...args: any[]) => {
      const observation = startObservation(`tool.${tool.name}`, 'tool');
      observation.update({ 'xopc.toolCallId': String(args[0]) }); observation.input(args[1]);
      return observation.run(async () => {
        try { const result = await tool.execute(...args); observation.finish(result?.isError || result?.details?.isError ? 'error' : 'success', result); return result; }
        catch (error) { observation.finish(args[2]?.aborted ? 'cancelled' : 'error', error instanceof Error ? error.message : String(error)); throw error; }
      });
    };
    tracedExecutions.add(execute);
    return { ...tool, execute };
  });
}
export async function flushTracing(): Promise<void> {
  const timer = new Promise<void>(resolve => { const t = setTimeout(resolve, 3000); t.unref(); });
  await Promise.race([(async () => { await Promise.allSettled([...pendingLocal]); await Promise.allSettled([store?.flush(), target?.flush()]); })(), timer]);
}
export async function testLangfuse(): Promise<boolean> {
  if (!target) return false;
  const result = await traceRun('diagnostic.langfuse', {}, async () => ({ ok: true }));
  await target.flush(); return result.ok && !target.status().lastError;
}

export async function closeTracing(): Promise<void> {
  await flushTracing(); target?.close(); target = undefined; targetSignature = ''; await store?.close(); store = undefined;
}

export async function traceOperation<T>(name: string, fn: () => Promise<T>, attributes: Attributes = {}): Promise<T> {
  const observation = startObservation(name, 'span'); observation.update(attributes);
  try { const result = await observation.run(fn); observation.finish(); return result; }
  catch (error) { observation.finish('error', error instanceof Error ? error.message : String(error)); throw error; }
}

export function setTraceIdentity(identity: TraceIdentity): void {
  const scope = scopes.getStore(); if (!scope) return;
  scope.identity = { ...scope.identity, ...identity }; scope.root?.setAttributes(attrs(scope.identity, 'agent'));
}
