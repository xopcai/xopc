// Relaunch the installed app against the same profile; keep the model fixture running.
import { createWriteStream, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { spawn } from 'node:child_process';

const metadata = JSON.parse(readFileSync('/tmp/xopc-packaged-e2e.json', 'utf8'));
const env = { ...Object.fromEntries(Object.entries(process.env).filter(([key]) => !/(API_KEY|ACCESS_TOKEN|AUTH_TOKEN|OAUTH_TOKEN|SECRET)$/i.test(key) && !['ELECTRON_RUN_AS_NODE', 'ELECTRON_RENDERER_URL', 'NODE_OPTIONS'].includes(key))), XOPC_STATE_DIR: metadata.state, XOPC_CONFIG_PATH: join(metadata.state, 'xopc.json'), XOPC_CONFIG: join(metadata.state, 'xopc.json'), XOPC_HOME: metadata.state, XOPC_LOG_DIR: join(metadata.state, 'logs'), PI_CODING_AGENT_DIR: join(metadata.state, 'pi'), XOPC_ELECTRON_DEBUG_LIFECYCLE: '1', XOPC_SKIP_CHANNELS: '1', XOPC_NO_RESPAWN: '1' };
const output = createWriteStream(join(metadata.state, 'relaunch-output.log'));
const startedAt = Date.now();
const child = spawn(join(metadata.application, 'Contents/MacOS/xopc'), [`--user-data-dir=${metadata.shellData}`, '--force-renderer-accessibility'], { env, stdio: ['ignore', 'pipe', 'pipe'] });
child.stdout.pipe(output); child.stderr.pipe(output);
metadata.relaunchPid = child.pid;
writeFileSync('/tmp/xopc-packaged-e2e.json', JSON.stringify(metadata, null, 2), { mode: 0o600 });
for (const signal of ['SIGINT', 'SIGTERM']) process.on(signal, () => child.kill(signal));
while (true) {
  if (child.exitCode !== null) throw new Error(`Installed relaunch exited: ${child.exitCode}`);
  try { const response = await fetch(metadata.base + '/api/health'); if ((await response.json()).ready) break; } catch { /* Production startup. */ }
  if (Date.now() - startedAt > 60000) throw new Error('Installed relaunch timed out');
  await new Promise(resolve => setTimeout(resolve, 250));
}
metadata.relaunchStartupMs = Date.now() - startedAt;
writeFileSync('/tmp/xopc-packaged-e2e.json', JSON.stringify(metadata, null, 2), { mode: 0o600 });
console.log(JSON.stringify({ pid: child.pid, startupMs: metadata.relaunchStartupMs, application: metadata.application }));
child.on('exit', code => { process.exitCode = code ?? 1; });
