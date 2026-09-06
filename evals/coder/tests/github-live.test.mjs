import { mkdtempSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { createServer } from 'node:http';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

import { ConfigSchema } from '../../../src/config/schema.ts';
import { assertSafeArtifacts, gatewayConfig, scrub, settingsFromEnv, waitForGateway } from '../scripts/run-github-eval.mjs';

const input = { CODER_EVAL_MODEL: 'deepseek/deepseek-v4-flash', CODER_EVAL_API_KEY: 'private-test-key' };

describe('manual live evaluation', () => {
  it('rejects missing credentials, unsupported auth, injected model input and excessive spend settings', () => {
    expect(() => settingsFromEnv({ ...input, CODER_EVAL_API_KEY: '' })).toThrow('repository secret');
    expect(() => settingsFromEnv({ ...input, CODER_EVAL_MODEL: 'openai-codex/model' })).toThrow('single API-key');
    expect(() => settingsFromEnv({ ...input, CODER_EVAL_MODEL: 'deepseek/model\n$(env)' })).toThrow('provider/model');
    expect(() => settingsFromEnv({ ...input, CODER_EVAL_REPETITIONS: '100' })).toThrow('Repetitions');
    expect(() => settingsFromEnv({ ...input, CODER_EVAL_REASONING: 'invalid' })).toThrow('reasoning');
    expect(settingsFromEnv(input)).toMatchObject({ repetitions: 1, reasoning: 'high' });
  });

  it('uses the real config schema and disables background model work', () => {
    const config = ConfigSchema.parse(gatewayConfig(input.CODER_EVAL_MODEL, '/tmp/eval', 18790, 'local-token'));
    expect(config.agents.default).toBe('coder');
    expect(config.agents.defaults.models.chat).toEqual({ primary: input.CODER_EVAL_MODEL, fallbacks: [] });
    expect(config.agents.defaults.runtime).toMatchObject({ maxTurns: 40, timeoutMs: 300000 });
    expect(config.gateway.auth).toMatchObject({ mode: 'token', token: 'local-token' });
    expect(config.gateway.heartbeat.enabled).toBe(false);
    expect(config.userContext.enabled).toBe(false);
    expect(config.userContext.understanding.enabled).toBe(false);
    expect(config.userContext.dreaming.mode).toBe('off');
  });

  it('waits for readiness and an authenticated runtime endpoint', async () => {
    let probes = 0;
    let authenticated = false;
    const server = createServer((req, res) => {
      res.setHeader('Content-Type', 'application/json');
      if (req.url === '/api/health') res.end(JSON.stringify({ ready: ++probes > 1 }));
      else {
        authenticated = req.headers.authorization === 'Bearer local-token';
        res.statusCode = authenticated ? 200 : 401;
        res.end('{}');
      }
    });
    await new Promise(done => server.listen(0, '127.0.0.1', done));
    try {
      await waitForGateway(`http://127.0.0.1:${server.address().port}`, 'local-token', { exitCode: null, signalCode: null }, 3000);
      expect(probes).toBeGreaterThan(1);
      expect(authenticated).toBe(true);
      await expect(waitForGateway('', '', { exitCode: 1, signalCode: null })).rejects.toThrow('exited');
    } finally {
      await new Promise(done => server.close(done));
    }
  });

  it('scrubs logs and blocks secrets in binary artifacts or symlink uploads', () => {
    const root = mkdtempSync(join(tmpdir(), 'live-artifacts-test-'));
    try {
      expect(scrub('failure: private-test-key', ['private-test-key'])).toBe('failure: [REDACTED]');
      writeFileSync(join(root, 'evals.db'), Buffer.from('SQLite\0private-test-key\0'));
      expect(() => assertSafeArtifacts(root, ['private-test-key'])).toThrow('Credential detected');
      writeFileSync(join(root, 'evals.db'), 'safe');
      expect(() => assertSafeArtifacts(root, ['private-test-key'])).not.toThrow();
      if (process.platform !== 'win32') {
        symlinkSync('/tmp', join(root, 'linked'));
        expect(() => assertSafeArtifacts(root, ['private-test-key'])).toThrow('symlink');
      }
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });
});
