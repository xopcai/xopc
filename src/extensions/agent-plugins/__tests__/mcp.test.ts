import { createServer } from 'node:http';
import { expect, it } from 'vitest';
import { createPluginSourceFetch } from '../source-http-fetch.js';

it('blocks redirect credential forwarding and private network requests', async () => {
  let leaked = false;
  const sink = createServer((_req, res) => { leaked = true; res.end(); });
  await new Promise<void>(r => sink.listen(0, '127.0.0.1', r));
  const source = createServer((_req, res) => { res.writeHead(302, { location: `http://127.0.0.1:${(sink.address() as {port:number}).port}` }); res.end(); });
  await new Promise<void>(r => source.listen(0, '127.0.0.1', r));
  try {
    const url = new URL(`http://127.0.0.1:${(source.address() as {port:number}).port}`);
    await expect(createPluginSourceFetch(url, { Authorization: 'secret' })(url)).rejects.toThrow();
    expect(leaked).toBe(false);
    await expect(createPluginSourceFetch(new URL('https://example.com'), {})('https://169.254.169.254')).rejects.toThrow('private');
    await expect(createPluginSourceFetch(new URL('https://example.com'), {})('https://[::ffff:127.0.0.1]')).rejects.toThrow('private');
  } finally { source.closeAllConnections(); sink.closeAllConnections(); await Promise.all([new Promise<void>(r => source.close(() => r())), new Promise<void>(r => sink.close(() => r()))]); }
});
