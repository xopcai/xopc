/** Native fetch adapter for pure transport tests; each test controls global fetch. */
export const fetch: typeof globalThis.fetch = (input, init) => globalThis.fetch(input, init);
