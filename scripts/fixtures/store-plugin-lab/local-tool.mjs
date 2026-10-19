import { readFileSync } from 'node:fs';
let input = '';
process.stdin.setEncoding('utf8');
process.stdin.on('data', chunk => {
  input += chunk;
  let end;
  while ((end = input.indexOf('\n')) >= 0) {
    const line = input.slice(0, end); input = input.slice(end + 1);
    if (!line.trim()) continue;
    try {
      const q = JSON.parse(line); if (q.id === undefined) continue;
      let result;
      if (q.method === 'initialize') result = { protocolVersion: '2025-03-26', serverInfo: { name: 'plugin-lab-local', version: '1.0.0' }, capabilities: { tools: {} } };
      else if (q.method === 'tools/list') result = { tools: [{ name: 'read_local_dataset', description: 'Read the Store-supplied dataset after local configuration.', inputSchema: { type: 'object', properties: {} } }] };
      else if (q.method === 'tools/call') {
        if (!process.env.LAB_ACCESS_KEY) throw new Error('Configure LAB_ACCESS_KEY in the host');
        result = { content: [{ type: 'text', text: readFileSync(process.env.LAB_DATASET, 'utf8') }] };
      } else result = {};
      process.stdout.write(JSON.stringify({ jsonrpc: '2.0', id: q.id, result }) + '\n');
    } catch { process.stdout.write(JSON.stringify({ jsonrpc: '2.0', id: null, error: { code: -32603, message: 'Local fixture failed' } }) + '\n'); }
  }
});
