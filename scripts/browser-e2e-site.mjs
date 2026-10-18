import { createServer } from 'node:http';
import { writeFileSync } from 'node:fs';
let visits = 0;
const server = createServer((req, res) => {
  if (req.url === '/slow') { res.writeHead(200, { 'content-type': 'text/html' }); res.write('<title>Slow page</title><h1>Loading slowly</h1>'); setTimeout(() => { if (!res.destroyed) res.end('<p>Slow page complete</p>'); }, 20000); return; }
  if (req.url === '/fail') { req.socket.destroy(); return; }
  if (req.url === '/redirect') { res.writeHead(302, { location: '/two' }).end(); return; }
  if (req.url === '/download') { res.writeHead(200, { 'content-type': 'text/plain', 'content-disposition': 'attachment; filename="browser-e2e.txt"' }).end('Browser download fixture'); return; }
  const two = req.url?.startsWith('/two');
  if (req.url?.startsWith('/one')) visits++;
  res.writeHead(200, { 'content-type': 'text/html', 'set-cookie': 'browser_fixture=isolated; SameSite=Lax; Path=/' });
  res.end(`<!doctype html><html><head><title>${two ? 'Page Two' : 'Page One'}</title><style>body{font:18px system-ui;padding:28px;color:#172033;background:#f6f8fa}a,button,input{display:block;margin:18px 0;font:inherit}button{padding:8px 16px}input{padding:10px}code{display:block}</style></head><body><h1>${two ? 'Page Two' : 'Page One'}</h1><p>Native Electron browser fixture</p><p>Visits: ${visits}</p><input aria-label="Page draft" placeholder="Keep this form when switching tabs"><a href="/two">Go to page two</a><a href="/one">Go to page one</a><a href="/two" target="_blank">Open page two in a new tab</a><a href="/slow">Open slow page</a><a href="/fail">Open failing page</a><a href="/download">Download fixture</a><button id="guard">Protect unsaved page</button><button id="permission">Request location</button><button id="crash">Page action</button><code id="isolation"></code><code id="cookie"></code><script>document.getElementById('isolation').textContent='Isolation: electronAPI='+typeof window.electronAPI+', require='+typeof require+', process='+typeof process;document.getElementById('cookie').textContent='Cookie: '+document.cookie;document.getElementById('guard').onclick=()=>{window.onbeforeunload=e=>{e.preventDefault();e.returnValue='Unsaved';};document.getElementById('guard').textContent='Unsaved page protected';};document.getElementById('permission').onclick=()=>navigator.geolocation.getCurrentPosition(()=>{},()=>document.getElementById('permission').textContent='Location denied');</script></body></html>`);
});
await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
const url = `http://127.0.0.1:${server.address().port}`;
writeFileSync('/tmp/xopc-browser-site.json', JSON.stringify({ url }));
console.log(url);
process.on('SIGINT', () => { server.closeAllConnections(); server.close(); });
