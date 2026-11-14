import { readFileSync } from 'node:fs';
import { registerHooks } from 'node:module';

export async function runGatewayBundle(root: URL, argv: string[]): Promise<boolean> {
  const index = JSON.parse(readFileSync(new URL('chunks.json', root), 'utf8')) as Record<string, [number, number]>;
  const bytes = readFileSync(new URL('chunks.bin', root));
  const base = root.href;
  const entry = new URL('gateway.js', root).href;
  const hooks = registerHooks({
    resolve(specifier, context, next) {
      const parent = context.parentURL;
      if (parent === import.meta.url && specifier === entry) return { url: entry, shortCircuit: true };
      if (parent?.startsWith(base) && parent.lastIndexOf('/') === base.length - 1 && specifier.startsWith('./')) {
        const name = specifier.slice(2);
        if (Object.hasOwn(index, name)) return { url: base + name, shortCircuit: true };
      }
      return next(specifier, context);
    },
    load(url, context, next) {
      const name = url.startsWith(base) ? url.slice(base.length) : undefined;
      if (!name || !Object.hasOwn(index, name)) return next(url, context);
      const [start, size] = index[name]!;
      return { format: 'module', source: bytes.subarray(start, start + size), shortCircuit: true };
    },
  });
  try {
    const { runBundledGateway } = await import(entry);
    return await runBundledGateway(argv);
  } finally {
    hooks.deregister();
  }
}
