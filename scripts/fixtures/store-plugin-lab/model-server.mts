import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { once } from 'node:events';
import { randomUUID } from 'node:crypto';

export async function startLabModel() {
  const targets = { notes: '', local: '' };
  const observed = { requests: 0, toolNames: [] as string[], sawHttpResult: false, sawStdioResult: false, failures: [] as string[] };
  const server = createServer(async (req, res) => {
    try {
      let source = ''; for await (const chunk of req) source += chunk;
      const body = JSON.parse(source), messages = body.messages ?? [];
      const tools = (body.tools ?? []).map((tool: any) => tool.function ?? tool);
      observed.requests++;
      observed.toolNames = [...new Set([...observed.toolNames, ...tools.map((tool: any) => String(tool.name))])];
      const results = messages.filter((message: any) => message.role === 'tool').map((message: any) => typeof message.content === 'string' ? message.content : JSON.stringify(message.content)).join('\n');
      observed.sawHttpResult ||= results.includes('sandbox-note-001');
      observed.sawStdioResult ||= results.includes('local-note-001');
      const complete = observed.sawHttpResult && observed.sawStdioResult;
      const codeTool = tools.find((tool: any) => tool.parameters?.properties?.code);
      let toolCalls: any[] | undefined, content: string | undefined;
      if (!tools.length && !results) content = 'Plugin Lab verification';
      else if (complete) content = 'PLUGIN_LAB_GATEWAY_E2E_OK sandbox-note-001 local-note-001';
      else if (codeTool && messages.filter((m: any) => m.role === 'tool').length < 4) {
        const code = `const remote = await searchTools('read', {namespace: ${JSON.stringify(targets.notes)}, limit: 10}); const local = await searchTools('read', {namespace: ${JSON.stringify(targets.local)}, limit: 10}); if (!remote[0] || !local[0]) throw new Error('Plugin tools not found: ' + JSON.stringify(ALL_TOOLS.map(tool => tool.name))); text(await tools[remote[0].name]({})); text(await tools[local[0].name]({}));`;
        toolCalls = [{ index: 0, id: 'call_' + randomUUID().replaceAll('-', ''), type: 'function', function: { name: codeTool.name, arguments: JSON.stringify({ code }) } }];
      } else {
        observed.failures.push(results.slice(-2000) || `Available tools: ${tools.map((t: any) => t.name).join(',')}`);
        content = 'PLUGIN_LAB_GATEWAY_E2E_FAILED';
      }
      const delta = toolCalls ? { role: 'assistant', tool_calls: toolCalls } : { role: 'assistant', content };
      const envelope = { id: randomUUID(), object: 'chat.completion.chunk', created: Math.floor(Date.now() / 1000), model: 'lab', choices: [{ index: 0, delta, finish_reason: null }] };
      res.writeHead(200, { 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-store' });
      res.write(`data: ${JSON.stringify(envelope)}\n\n`);
      res.write(`data: ${JSON.stringify({ ...envelope, choices: [{ index: 0, delta: {}, finish_reason: toolCalls ? 'tool_calls' : 'stop' }], usage: { prompt_tokens: 50, completion_tokens: 20, total_tokens: 70 } })}\n\n`);
      res.end('data: [DONE]\n\n');
    } catch (error) { observed.failures.push(String(error)); res.writeHead(500).end(); }
  });
  server.listen(0, '127.0.0.1'); await once(server, 'listening');
  const address = server.address(); assert(address && typeof address !== 'string');
  return { targets, baseUrl: `http://127.0.0.1:${address.port}/v1`, observed, async close() { server.closeAllConnections(); await new Promise<void>(resolve => server.close(() => resolve())); } };
}
