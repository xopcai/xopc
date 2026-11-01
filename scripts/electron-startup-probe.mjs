// Opt-in instrumentation for the diagnostic runner; never use it for budget acceptance.
import assert from 'node:assert/strict';

import { _electron } from 'playwright-core';

assert(process.argv.includes('--diagnostics') && !process.argv.includes('--compare'), 'Startup probe requires diagnostic-only sampling');
const launch = _electron.launch.bind(_electron);
_electron.launch = async (...args) => {
  const application = await launch(...args);
  await application.evaluate(({ session }) => {
    const resolveProxy = session.defaultSession.resolveProxy;
    session.defaultSession.resolveProxy = async function (...values) {
      const start = performance.now(), cpu = process.cpuUsage();
      try { return await resolveProxy.apply(this, values); }
      finally {
        (globalThis.__acceptanceStartupTrace ??= []).push({ kind: 'electron-proxy-resolution',
          start: performance.timeOrigin + start, elapsedMs: performance.now() - start,
          cpuMicroseconds: process.cpuUsage(cpu) });
      }
    };
  });
  return application;
};
