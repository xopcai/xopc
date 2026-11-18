import { cpSync, existsSync, mkdtempSync, rmSync } from 'node:fs';
import { homedir, tmpdir } from 'node:os';
import { join } from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';

export async function openEvaluationRuntime() {
  const source = process.env.XOPC_STATE_DIR ?? join(homedir(), '.xopc');
  const state = mkdtempSync(join(tmpdir(), 'xopc-long-replies-'));
  process.once('exit', () => rmSync(state, { force: true, recursive: true }));
  for (const relative of ['cache/model-catalog', 'models.json']) {
    const path = join(source, relative);
    if (existsSync(path)) cpSync(path, join(state, relative), { recursive: true });
  }
  const config = process.env.XOPC_CONFIG_PATH ?? process.env.XOPC_CONFIG ?? join(source, 'xopc.json');
  Object.assign(process.env, {
    XOPC_STATE_DIR: state,
    XOPC_WORKSPACE: join(state, 'workspace'),
    XOPC_CONFIG_PATH: config,
    XOPC_CONFIG: config,
    XOPC_CREDENTIALS_DIR: process.env.XOPC_CREDENTIALS_DIR ?? join(source, 'credentials'),
    XOPC_LOG_DIR: join(state, 'logs'),
    XOPC_LOG_LEVEL: 'fatal',
    XOPC_LOG_CONSOLE: 'false',
  });

  await import('../../../src/infra/http-proxy-env.js');
  const { openXopcDatabase, closeXopcDatabase } = await import('../../../src/storage/sqlite/index.js');
  const { resolveModel } = await import('../../../src/providers/index.js');
  const { completeWithResolvedCredentials } = await import('../../../src/providers/model-call.js');
  const { isTransientProviderErrorMessage } = await import('../../../src/providers/model-response.js');
  openXopcDatabase({ path: join(state, 'xopc.db') });

  let nextEvaluatorCall = 0;
  let cooldownUntil = 0;
  const retryEvents: { operation: string; kind: 'rate_limit' | 'transient'; at: string }[] = [];

  async function takeEvaluatorSlot() {
    do {
      const eligible = Math.max(Date.now(), nextEvaluatorCall, cooldownUntil);
      nextEvaluatorCall = eligible + 3400;
      await delay(Math.max(0, eligible - Date.now()));
    } while (Date.now() < cooldownUntil);
  }

  async function complete(
    model: ReturnType<typeof resolveModel>,
    systemPrompt: string,
    content: string,
    operation: 'generate' | 'read' | 'judge',
  ) {
    for (let attempt = 1; ; attempt++) {
      if (operation !== 'generate') await takeEvaluatorSlot();
      const started = Date.now();
      try {
        const result = await completeWithResolvedCredentials(model, {
          systemPrompt,
          messages: [{ role: 'user', content, timestamp: started }],
        }, {
          maxTokens: operation === 'read' ? 1200 : 4096,
          signal: AbortSignal.timeout(60_000),
        }, undefined, { operation: 'personal_long_reply_' + operation, trigger: 'user' });
        const text = result.content.map(block => block.type === 'text' ? block.text : '').join('').trim();
        if (result.errorMessage || result.stopReason !== 'stop' || !text) {
          throw new Error(result.errorMessage ?? 'Unusable completion: ' + result.stopReason);
        }
        return { text, model: result.model, usage: result.usage, elapsedMs: Date.now() - started };
      } catch (error) {
        const message = String(error);
        if (attempt >= 3) throw error;
        if (/\b429\b.*rate limit|rate_limit_exceeded/i.test(message)) {
          retryEvents.push({ operation, kind: 'rate_limit', at: new Date().toISOString() });
          cooldownUntil = Math.max(cooldownUntil, Date.now() + 60_000);
          console.error('Provider rate limit; retrying the unchanged request after cooldown');
          if (operation === 'generate') await delay(60_000);
        } else if (isTransientProviderErrorMessage(message)) {
          retryEvents.push({ operation, kind: 'transient', at: new Date().toISOString() });
          await delay(attempt * 1500);
        } else {
          throw error;
        }
      }
    }
  }

  return { resolveModel, complete, close: closeXopcDatabase, workspace: join(state, 'workspace'), retryEvents };
}
