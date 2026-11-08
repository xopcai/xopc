import type { LocalAppExecutionAuthority } from '@xopcai/gateway-contract';
import { readFileSync } from 'node:fs';
import { runSqliteWriteTransaction } from '../storage/sqlite/transaction.js';
import { DurableState } from '../storage/sqlite/durable-state.js';
import { withExecutionAuthority } from '../infra/execution-authority.js';
import { LocalAppStore } from './store.js';
import { classifyCostSource } from '../usage/cost.js';
import { resolveConfigPath } from '../config/paths.js';
import { getAutomationRun, getAutomationRunRequest } from '../automations/storage/index.js';
import { isBareProfileMarkdownFileName } from '../agent/tools/tool-paths.js';

export type LocalAppRunAuthority = { extensionId: string; automationId: string; manifestDigest: string;
  releaseId: string; grantRevision: string; configurationDigest: string; authority: LocalAppExecutionAuthority };
const readTools = new Set(['read_file', 'list_dir']);
const writeTools = new Set(['write_file', 'edit_file', 'apply_patch']);

export function assertLocalAppRunAuthority(runId: string): LocalAppRunAuthority | undefined {
  const record = new DurableState<LocalAppRunAuthority>('local-app-run-authority').get(runId);
  if (!record) return;
  const store = new LocalAppStore();
  const app = store.findByExtensionId(record.extensionId);
  const grant = store.getUiGrant(record.extensionId, record.manifestDigest);
  const config = JSON.parse(readFileSync(process.env.XOPC_CONFIG_PATH || resolveConfigPath(), 'utf8')) as { extensions?: { enabled?: string[]; disabled?: string[] } };
  if (!app?.enabled || app.installationState !== 'installed' || app.activeReleaseId !== record.releaseId
    || !config.extensions?.enabled?.includes(record.extensionId) || config.extensions?.disabled?.includes(record.extensionId)
    || !grant?.granted || grant.grantRevision !== record.grantRevision || record.authority.expiresAt <= Date.now()
    || !grant.resourceScopes || grant.resourceScopes.automationsRun.mode !== 'selected'
    || !grant.resourceScopes.automationsRun.approvals.some(item => item.id === record.automationId
      && item.configurationDigest === record.configurationDigest)) throw new Error('Local App execution authority expired or was revoked');
  return record;
}

export async function withLocalAppRunAuthority<T>(runId: string, signal: AbortSignal,
  execute: (signal: AbortSignal) => Promise<T>): Promise<T> {
  const record = assertLocalAppRunAuthority(runId);
  if (!record) return execute(signal);
  const controller = new AbortController();
  const abort = () => controller.abort(signal.reason);
  signal.addEventListener('abort', abort, { once: true });
  if (signal.aborted) abort();
  const check = () => {
    assertLocalAppRunAuthority(runId);
    if (getAutomationRun(runId)?.status !== 'running') throw new Error('Execution is no longer active');
    if (controller.signal.aborted) throw controller.signal.reason ?? new Error('Execution stopped');
  };
  const timer = setInterval(() => { try { check(); } catch (error) { controller.abort(error); } }, 100);
  const policy = record.authority;
  const canWrite = policy.dataWrite && (getAutomationRunRequest(runId)?.safety?.mode ?? 'auto_apply') === 'auto_apply';
  const unrestrictedTools = false;
  try {
    return await withExecutionAuthority({ revision: JSON.stringify(record), unrestrictedTools, assertCurrent: check,
      allowsTool: name => policy.tools && (readTools.has(name) || canWrite && writeTools.has(name)),
      assertTool(_name, args) {
        check();
        const path = (args as { path?: unknown })?.path;
        if (typeof path === 'string' && isBareProfileMarkdownFileName(path)) throw new Error('Agent profile access is outside this execution scope');
      },
      reserveModel(model) {
        check();
        if (!policy.model) throw new Error('Model execution was not approved');
        const limits = model as typeof model & { contextWindow?: number; maxTokens?: number };
        if (classifyCostSource(model) === 'unknown' || !limits.contextWindow || !limits.maxTokens) throw new Error('A bounded model with known pricing is required');
        const prices = Object.values(model.cost ?? {}).flatMap(value => Array.isArray(value)
          ? value.flatMap(tier => [tier.input, tier.output, tier.cacheRead, tier.cacheWrite]) : [value]);
        if (!prices.length || prices.some(price => !Number.isFinite(price) || price < 0)) throw new Error('Invalid model pricing');
        // Reserve the full context and output ceilings before transport. Never refund uncertain usage.
        const reservation = Math.ceil((limits.contextWindow + limits.maxTokens) * Math.max(...prices));
        if (!Number.isSafeInteger(reservation)) throw new Error('Invalid cost reservation');
        runSqliteWriteTransaction(() => {
          new DurableState<number>('local-app-execution-model-calls').update(runId, previous => {
            if ((previous ?? 0) >= 20) throw new Error('Model call limit exhausted');
            return { value: (previous ?? 0) + 1, result: undefined };
          });
          const budget = new DurableState<number>('local-app-execution-cost', record.extensionId);
          const key = `${record.grantRevision}:${record.automationId}`;
          const spent = budget.get(key) ?? 0;
          if (spent + reservation > policy.maxCostMicrousd) throw new Error('Local App model cost budget exhausted');
          budget.set(key, spent + reservation);
        });
      },
    }, () => execute(controller.signal));
  } finally { clearInterval(timer); signal.removeEventListener('abort', abort); }
}

export function assertLocalAppDelivery(runId: string, kind: string): void {
  const record = assertLocalAppRunAuthority(runId);
  if (record && kind === 'file' && !record.authority.dataWrite) throw new Error('File delivery was not approved');
  if (record && !['gateway_event', 'file'].includes(kind) && !record.authority.externalSend) throw new Error('External delivery was not approved');
}
