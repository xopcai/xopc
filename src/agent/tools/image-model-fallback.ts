import type { ToolModelConfig } from './model-config.helpers.js';

export type ImageAttempt = { provider: string; model: string; error: string };

function collectModelRefs(params: {
  toolConfig: ToolModelConfig;
  modelOverride?: string;
}): string[] {
  const refs: string[] = [];
  const add = (raw: string | undefined) => {
    const t = raw?.trim();
    if (t?.includes('/')) {
      refs.push(t);
    }
  };
  add(params.modelOverride);
  add(params.toolConfig.primary);
  for (const f of params.toolConfig.fallbacks ?? []) {
    add(f);
  }
  const seen = new Set<string>();
  const out: string[] = [];
  for (const r of refs) {
    if (!seen.has(r)) {
      seen.add(r);
      out.push(r);
    }
  }
  return out;
}

export async function runWithImageModelFallback<T>(params: {
  toolConfig: ToolModelConfig;
  modelOverride?: string;
  run: (modelRef: string) => Promise<T>;
}): Promise<{ result: T; attempts: ImageAttempt[] }> {
  const refs = collectModelRefs({
    toolConfig: params.toolConfig,
    modelOverride: params.modelOverride,
  });
  if (refs.length === 0) {
    throw new Error(
      'No image model configured. Set agents.defaults.imageModel.primary or add fallbacks.',
    );
  }

  const attempts: ImageAttempt[] = [];
  let lastErr: unknown;

  for (const modelRef of refs) {
    try {
      const result = await params.run(modelRef);
      return { result, attempts };
    } catch (err) {
      lastErr = err;
      const msg = err instanceof Error ? err.message : String(err);
      const slash = modelRef.indexOf('/');
      attempts.push({
        provider: slash > 0 ? modelRef.slice(0, slash) : modelRef,
        model: slash > 0 ? modelRef.slice(slash + 1) : '',
        error: msg,
      });
    }
  }

  const summary = attempts.map((a) => `${a.provider}/${a.model}: ${a.error}`).join(' | ');
  throw new Error(
    `All image models failed (${attempts.length}): ${summary || (lastErr instanceof Error ? lastErr.message : String(lastErr))}`,
  );
}
