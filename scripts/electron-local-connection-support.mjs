import { createHash } from 'node:crypto';
import { lstat, mkdir, open, readFile, readdir, realpath, rm, symlink, writeFile } from 'node:fs/promises';
import { dirname, join, relative, resolve } from 'node:path';

/** Include Gateway, static UI and SQL assets, not just Electron entry points. */
export async function localConnectionArtifactManifest(root) {
  const manifest = {};
  for (const directory of ['out/main', 'out/preload', 'out/server', 'dist', 'src/storage/sqlite']) {
    const hash = createHash('sha256');
    let entries;
    try { entries = await readdir(join(root, directory), { recursive: true, withFileTypes: true }); }
    catch (error) { if (error.code === 'ENOENT') { manifest[directory] = null; continue; } throw error; }
    const files = entries.filter(entry => entry.isFile()).map(entry => join(entry.parentPath, entry.name)).sort();
    for (const file of files) hash.update(relative(root, file)).update('\0').update(await readFile(file)).update('\0');
    manifest[directory] = { files: files.length, sha256: hash.digest('hex') };
  }
  return manifest;
}

/** Serialize access to the development layout without replacing existing output. */
export async function prepareLocalConnectionLayout(root, runnerRoot = root) {
  const out = join(root, 'out');
  const lock = join(runnerRoot, 'out/local-connection-acceptance.lock');
  const link = join(out, 'dist');
  await mkdir(out, { recursive: true });
  await mkdir(join(runnerRoot, 'out'), { recursive: true });
  try { await mkdir(lock); } catch (error) {
    if (error.code === 'EEXIST') throw new Error(`Acceptance layout is locked: ${lock}`);
    throw error;
  }
  let createdLink = false;
  const cleanup = async () => {
    try { if (createdLink) await rm(link); }
    finally { await rm(lock, { recursive: true, force: true }); }
  };
  try {
    await writeFile(join(lock, 'owner.json'), JSON.stringify({ pid: process.pid, startedAt: new Date().toISOString() }));
    try {
      await symlink('../dist', link, 'dir');
      createdLink = true;
    } catch (error) {
      if (error.code !== 'EEXIST') throw error;
      if (!(await lstat(link)).isSymbolicLink() || await realpath(link) !== await realpath(join(root, 'dist'))) {
        throw new Error(`Acceptance layout conflicts with existing output: ${link}`);
      }
    }
    return cleanup;
  } catch (error) {
    await cleanup();
    throw error;
  }
}

export function localConnectionEnvironment(inherited, root, state, configPath, workspace) {
  const env = Object.fromEntries(Object.entries(inherited).filter(([key]) =>
    !/^(XOPC_|PI_|ELECTRON_)/.test(key) && key !== 'NODE_OPTIONS'
    && !/(API_KEY|TOKEN|SECRET|PASSWORD|CREDENTIAL)/i.test(key)));
  return Object.assign(env, {
    XOPC_STATE_DIR: state, XOPC_CONFIG_PATH: configPath, XOPC_CONFIG: configPath,
    XOPC_HOME: state, XOPC_WORKSPACE: workspace, PI_CODING_AGENT_DIR: join(state, 'pi'),
    XOPC_CREDENTIALS_DIR: join(state, 'credentials'), XOPC_UI_STATIC_ROOT: join(root, 'dist/gateway/static/root'),
    XOPC_LOG_DIR: join(state, 'logs'), XOPC_LOG_FILE: 'false', XOPC_LOG_CONSOLE: 'false',
    XOPC_SKIP_CHANNELS: '1', XOPC_NO_RESPAWN: '1', ELECTRON_EMBED_GATEWAY: '1',
    XOPC_ELECTRON_USER_DATA_DIR: join(state, 'electron'),
    XOPC_SQLITE_ASSET_ROOT: join(root, 'src/storage/sqlite'), ZDOTDIR: state,
  });
}

export async function withTimeout(operation, timeoutMs, message) {
  let timer;
  try {
    return await Promise.race([operation, new Promise((_, reject) => {
      timer = setTimeout(() => reject(new Error(message)), timeoutMs);
    })]);
  } finally { clearTimeout(timer); }
}

/** Reserve a fresh evidence file before starting a test process. */
export async function createAcceptanceOutput(defaultPath, args = process.argv.slice(2)) {
  const index = args.indexOf('--output');
  if (index >= 0 && (!args[index + 1] || args[index + 1].startsWith('--'))) throw new Error('Missing acceptance output path');
  const output = resolve(index < 0 ? defaultPath : args[index + 1]);
  await mkdir(dirname(output), { recursive: true });
  let file;
  try { file = await open(output, 'wx', 0o600); }
  catch (error) {
    if (error.code === 'EEXIST') throw new Error('Acceptance output exists; use a new path to retain evidence');
    throw error;
  }
  try { await file.writeFile(JSON.stringify({ passed: false, state: 'initializing', startedAt: new Date().toISOString() }) + '\n'); }
  finally { await file.close(); }
  return output;
}
