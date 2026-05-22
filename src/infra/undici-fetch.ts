import { fetch as undiciFetch } from 'undici';

export function loadUndiciRuntimeDeps(): { fetch: typeof undiciFetch } {
  return { fetch: undiciFetch };
}
