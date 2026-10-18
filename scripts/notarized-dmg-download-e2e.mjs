// Download the actual release through Chrome so macOS receives a real quarantine record.
import { createServer } from 'node:http';
import { createReadStream, statSync, writeFileSync } from 'node:fs';
import { createHash, randomUUID } from 'node:crypto';
import { join, resolve } from 'node:path';
import { homedir } from 'node:os';

const artifact = resolve(process.argv[2] ?? 'dist/release/xopc-0.0.392-arm64.dmg');
const name = `xopc-0.0.392-notarized-acceptance-${randomUUID().slice(0, 8)}.dmg`;
const server = createServer((req, res) => {
  if (req.url === '/download') {
    res.writeHead(200, { 'Content-Type': 'application/x-apple-diskimage', 'Content-Disposition': `attachment; filename="${name}"`, 'Content-Length': statSync(artifact).size, 'Cache-Control': 'no-store' });
    createReadStream(artifact).pipe(res);
  } else {
    res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store' });
    res.end('<!doctype html><title>XOPC Notarization Acceptance</title><h1>Notarized DMG acceptance</h1><p>Download the final signed and stapled release for first-install verification.</p><a href="/download">Download notarized XOPC DMG</a>');
  }
});
await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
const hash = createHash('sha256'); for await (const block of createReadStream(artifact)) hash.update(block);
const metadata = { artifact, name, url: `http://127.0.0.1:${server.address().port}`, expectedDownloadPath: join(homedir(), 'Downloads', name), sha256: hash.digest('hex') };
writeFileSync('/tmp/xopc-notarized-download.json', JSON.stringify(metadata, null, 2));
console.log(JSON.stringify(metadata, null, 2));
for (const signal of ['SIGINT', 'SIGTERM']) process.on(signal, () => { server.closeAllConnections(); server.close(); });
