// Opt-in acceptance diagnostics only. Never record headers, bodies, credentials or query strings.
const http = require('node:http');
const { appendFile } = require('node:fs');
const { performance } = require('node:perf_hooks');
const path = process.env.XOPC_ACCEPTANCE_HTTP_TRACE;
if (path) {
  const emit = http.Server.prototype.emit;
  http.Server.prototype.emit = function (event, ...args) {
    if (event === 'request') {
      const [request, response] = args;
      const start = performance.now();
      const cpu = process.cpuUsage();
      let requestId;
      const writeHead = response.writeHead;
      response.writeHead = function (status, ...headers) {
        for (const value of headers) {
          if (Array.isArray(value)) {
            for (let i = 0; i < value.length; i += 2) if (String(value[i]).toLowerCase() === 'x-request-id') requestId = value[i + 1];
          } else if (value && typeof value === 'object') {
            for (const [name, header] of Object.entries(value)) if (name.toLowerCase() === 'x-request-id') requestId = header;
          }
        }
        return writeHead.call(this, status, ...headers);
      };
      response.once('finish', () => {
        const elapsedMs = performance.now() - start;
        appendFile(path, JSON.stringify({ pid: process.pid, path: request.url.split('?')[0],
          requestId: response.getHeader('x-request-id') ?? requestId, start: performance.timeOrigin + start,
          elapsedMs, cpuMicroseconds: process.cpuUsage(cpu), status: response.statusCode }) + '\n', () => {});
      });
    }
    return emit.call(this, event, ...args);
  };
}
