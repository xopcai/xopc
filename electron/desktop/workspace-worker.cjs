const { parentPort, workerData } = require('node:worker_threads');
const { createHash } = require('node:crypto');

// Only a bundled Main-owned path and a native-selected directory may populate workerData.
const native = require(workerData.addonPath);
const root = native.openRoot(workerData.root);
parentPort.on('message', input => {
  try {
    let result;
    if (input.action === 'read') {
      const bytes = native.readFile(root, input.relativePath);
      result = { text: new TextDecoder('utf-8', { fatal: true }).decode(bytes), version: createHash('sha256').update(bytes).digest('hex'), bytes: bytes.length };
    } else if (input.action === 'write') {
      result = { version: native.writeFile(root, input.relativePath, input.text, input.expectedVersion), bytes: Buffer.byteLength(input.text, 'utf8') };
    } else if (input.action === 'list') result = native.list(root, input.relativePath);
    else throw new Error('WORKSPACE_ARGUMENT_INVALID');
    parentPort.postMessage({ ok: true, result });
  } catch (error) {
    const code = /^WORKSPACE_[A-Z_]+$/.test(error?.code ?? '') ? error.code
      : input.action === 'write' ? 'WORKSPACE_OUTCOME_UNKNOWN' : 'WORKSPACE_READ_FAILED';
    parentPort.postMessage({ ok: false, error: code });
  }
});
parentPort.postMessage({ ready: true, identity: native.rootInfo(root) });
