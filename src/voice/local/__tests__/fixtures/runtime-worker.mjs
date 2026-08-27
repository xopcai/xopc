import { createInterface } from 'node:readline';

const lines = createInterface({ input: process.stdin });
lines.on('line', (line) => {
  const request = JSON.parse(line);
  const delayMs = Number(request.params?.delayMs ?? 0);
  setTimeout(() => {
    process.stdout.write(`${JSON.stringify({
      id: request.id,
      result: { method: request.method, completedAt: Date.now() },
    })}\n`);
  }, delayMs);
});
