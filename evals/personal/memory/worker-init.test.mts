import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';

test('isolated worker initializes strict catalog entries without model or private-account access', () => {
  const root = mkdtempSync(join(tmpdir(),'xopc-memory-init-test-'));
  try {
    const snapshot = join(root,'snapshot.json'), input = join(root,'input.json'), out = join(root,'out');
    const source = join(root,'source'); mkdirSync(source);
    writeFileSync(snapshot,JSON.stringify({ config:{},defaults:{models:{}} }),{mode:0o600});
    writeFileSync(input,JSON.stringify({id:'initialization-control'}));
    const hash = createHash('sha256').update(readFileSync(snapshot)).digest('hex');
    const child = spawnSync(process.execPath,['--import','tsx','evals/personal/memory/worker.mts','--init-only',
      '--input',input,'--out',out,'--model','xopc-cloud/openai-codex/gpt-5.6-sol','--judge','xopc-cloud/openai-codex/gpt-6.1-sol'],{
      encoding:'utf8',timeout:30_000,env:{...process.env,XOPC_STATE_DIR:source,XOPC_MEMORY_CONFIG_SNAPSHOT:snapshot,
        XOPC_MEMORY_CONFIG_HASH:hash,XOPC_STYLE_POOL_URL:'http://127.0.0.1:1',XOPC_STYLE_POOL_TOKEN:'unused'} });
    assert.equal(child.status,0,child.stderr);
    const initialized = JSON.parse(readFileSync(join(out,'initialization.json'),'utf8'));
    assert.equal(initialized.mainWorkspaceIsolated,true);
    const audit = JSON.parse(readFileSync(join(out,'protocol-audit.json'),'utf8'));
    assert.equal(audit.physicalRequests,0); assert.equal(audit.valid,true);
    assert.equal(existsSync(join(out,'model-requests.jsonl')),false);
  } finally { rmSync(root,{recursive:true,force:true}); }
});
