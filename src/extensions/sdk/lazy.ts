/**
 * Lazy dynamic import helpers for extension entrypoints.
 */

export function lazyModule<T>(loader: () => Promise<T>): () => Promise<T> {
  let cached: T | undefined;
  let loading: Promise<T> | undefined;

  return async () => {
    if (cached) return cached;

    if (!loading) {
      loading = loader().then((module) => {
        cached = module;
        loading = undefined;
        return module;
      });
    }

    return loading;
  };
}

export function lazyFunction<TModule, TArgs extends unknown[], TReturn>(
  loader: () => Promise<TModule>,
  selector: (module: TModule) => (...args: TArgs) => TReturn,
): (...args: TArgs) => Promise<TReturn> {
  const load = lazyModule(loader);

  return async (...args: TArgs) => {
    const module = await load();
    const fn = selector(module);
    return fn(...args);
  };
}
