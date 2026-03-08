// API Utilities - Shared API helpers

import { getBaseUrl } from './url.js';

export function apiUrl(path: string): string {
  return `${getBaseUrl()}${path}`;
}

export function authHeaders(token?: string): Record<string, string> {
  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
  };
  if (token) {
    headers['Authorization'] = `Bearer ${token}`;
  }
  return headers;
}

export async function fetchJson<T>(
  url: string,
  options?: RequestInit
): Promise<T> {
  const res = await fetch(url, options);
  
  if (!res.ok) {
    const errorBody = await res.json().catch(() => ({}));
    throw new Error(
      errorBody.error?.message || `HTTP ${res.status}: ${res.statusText}`
    );
  }
  
  return res.json();
}

export async function fetchText(
  url: string,
  options?: RequestInit
): Promise<string> {
  const res = await fetch(url, options);
  
  if (!res.ok) {
    throw new Error(`HTTP ${res.status}: ${res.statusText}`);
  }
  
  return res.text();
}
