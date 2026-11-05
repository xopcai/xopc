import { createHash } from 'node:crypto';
import { appendFileSync } from 'node:fs';
import { createInterface } from 'node:readline';

let generation = 1;
const eliciting = new Map();
const send = message => process.stdout.write(JSON.stringify({ jsonrpc: '2.0', ...message }) + '\n');
for await (const line of createInterface({ input: process.stdin })) {
  const request = JSON.parse(line);
  if (request.id === undefined) continue;
  const { id, method, params } = request;
  if (!method && eliciting.has(id)) {
    const original = eliciting.get(id);
    eliciting.delete(id);
    if (original.write && request.result?.action === 'accept') appendFileSync(process.env.XOPC_FIXTURE_EFFECT_PATH, 'after\n');
    send({ id: original.id, result: { content: [{ type: 'text', text: request.result?.action === 'accept' ? request.result.content.answer : 'declined' }] } });
    continue;
  }
  if (method === 'initialize') send({ id, result: { protocolVersion: params.protocolVersion,
    serverInfo: { name: 'device-mcp-fixture', version: '1' }, capabilities: { tools: { listChanged: true }, resources: {} },
    instructions: 'Read the installed device fixture.' } });
  else if (method === 'tools/list') send({ id, result: { tools: [
    { name: 'Read-Temperature', description: `Temperature generation ${generation}`, inputSchema: { type: 'object' },
      outputSchema: { type: 'object', properties: { value: { type: 'number' } }, required: ['value'] } },
    { name: 'increment_counter', description: 'Increment the isolated fixture counter', inputSchema: { type: 'object', additionalProperties: false } },
    { name: 'read_image', description: 'Read a device image fixture', inputSchema: { type: 'object' } },
    { name: 'ask_device', description: 'Read a user-supplied answer', inputSchema: { type: 'object', additionalProperties: false } },
    { name: 'write_with_form', description: 'Apply two counted effects around an interactive form', inputSchema: { type: 'object', additionalProperties: false } },
    { name: 'inspect_artifact', description: 'Calculate a device artifact checksum', inputSchema: {
      type: 'object', properties: { payload: { type: 'string' } }, required: ['payload'], additionalProperties: false,
    } },
    { name: 'refresh_catalog', description: 'Refresh the test catalog', inputSchema: { type: 'object' } },
    { name: 'not_installed', description: 'Must never become callable', inputSchema: { type: 'object' }, annotations: { readOnlyHint: true } },
  ] } });
  else if (method === 'tools/call' && params.name === 'Read-Temperature') send({ id, result: {
    content: [{ type: 'text', text: '23 degrees' }], structuredContent: { value: 23 } } });
  else if (method === 'tools/call' && params.name === 'increment_counter') {
    if (!process.env.XOPC_FIXTURE_EFFECT_PATH) throw new Error('Fixture effect path is required');
    appendFileSync(process.env.XOPC_FIXTURE_EFFECT_PATH, '1\n');
    const progressToken = params._meta?.progressToken;
    if (progressToken !== undefined) send({ method: 'notifications/progress', params: { progressToken, progress: 1, total: 2, message: 'effect committed' } });
    await new Promise(resolve => setTimeout(resolve, 1000));
    send({ id, result: { content: [{ type: 'text', text: 'incremented' }] } });
  }
  else if (method === 'tools/call' && params.name === 'read_image') send({ id, result: { content: [{ type: 'image', mimeType: 'image/png',
    data: 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jT3sAAAAASUVORK5CYII=' }] } });
  else if (method === 'tools/call' && params.name === 'inspect_artifact') send({ id, result: { content: [{ type: 'text',
    text: createHash('sha256').update(Buffer.from(params.arguments.payload, 'base64')).digest('hex') }] } });
  else if (method === 'tools/call' && ['ask_device', 'write_with_form'].includes(params.name)) {
    const formId = 'device-form-' + id;
    const write = params.name === 'write_with_form';
    if (write) appendFileSync(process.env.XOPC_FIXTURE_EFFECT_PATH, 'before\n');
    eliciting.set(formId, { id, write });
    send({ id: formId, method: 'elicitation/create', params: { mode: 'form', message: 'Enter the fixture answer',
      requestedSchema: { type: 'object', properties: { answer: { type: 'string', minLength: 2 } }, required: ['answer'] } } });
  }
  else if (method === 'tools/call' && params.name === 'refresh_catalog') {
    generation++;
    send({ id, result: { content: [{ type: 'text', text: 'updated' }] } });
    send({ method: 'notifications/tools/list_changed' });
  } else if (method === 'resources/read') send({ id, result: { contents: [{ uri: params.uri, text: 'device resource' }] } });
  else send({ id, error: { code: -32601, message: 'Unknown fixture method' } });
}
