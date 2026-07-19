import { apiFetch } from '@/lib/fetch';
import { apiUrl } from '@/lib/url';

export type ExtensionMarketplacePackageDetail = {
  id: string;
  name: string;
  type: string;
  description: string;
  readme: string | null;
  downloads: number;
  author: { username: string; avatarUrl: string | null };
  latestVersion: {
    version: string;
    changelog: string | null;
    publishedAt: string;
  };
  installability: {
    available: boolean;
    reason?: string;
    sha256?: string;
  };
  manifest?: Record<string, unknown>;
  packageSummary?: {
    dependencyCount: number;
    lifecycleScripts: string[];
  };
};

async function readErrorMessage(res: Response): Promise<string> {
  try {
    const j = (await res.json()) as {
      error?: string | { message?: string };
      message?: string;
    };
    if (typeof j.error === 'string') return j.error;
    if (j.error && typeof j.error === 'object' && typeof j.error.message === 'string') {
      return j.error.message;
    }
    if (typeof j.message === 'string') return j.message;
  } catch {
    /* ignore */
  }
  return res.statusText || `HTTP ${res.status}`;
}

export async function getExtensionMarketplacePackageDetail(
  packageName: string,
): Promise<ExtensionMarketplacePackageDetail> {
  const enc = encodeURIComponent(packageName.trim());
  const res = await apiFetch(apiUrl(`/api/marketplace/packages/${enc}`), { cache: 'no-store' });
  if (!res.ok) {
    throw new Error(await readErrorMessage(res));
  }
  const data = (await res.json()) as {
    ok?: boolean;
    error?: string;
    payload?: ExtensionMarketplacePackageDetail;
  };
  if (!data.ok || !data.payload?.id) {
    throw new Error(data.error ?? 'Invalid response');
  }
  return data.payload;
}

export async function installExtensionFromMarketplace(opts: {
  name: string;
  version?: string;
  overwrite?: boolean;
}): Promise<{ extensionId: string; version: string; requiresGatewayRestart: boolean }> {
  const res = await apiFetch(apiUrl('/api/marketplace/install'), {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(opts),
  });
  if (!res.ok) {
    throw new Error(await readErrorMessage(res));
  }
  const data = (await res.json()) as {
    ok?: boolean;
    error?: string;
    payload?: { extensionId: string; version: string; requiresGatewayRestart: boolean };
  };
  if (!data.ok || !data.payload?.extensionId) {
    throw new Error(data.error ?? 'Invalid response');
  }
  return data.payload;
}

/** Persist `extensions.enabled` / `extensions.disabled` for a bundled extension (gateway may need restart to load code). */
export async function postBundledExtensionActivation(opts: {
  extensionId: string;
  enabled: boolean;
}): Promise<{ requiresGatewayRestart: boolean }> {
  const res = await apiFetch(apiUrl('/api/extensions/bundled/activation'), {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ extensionId: opts.extensionId.trim(), enabled: opts.enabled }),
  });
  if (!res.ok) {
    throw new Error(await readErrorMessage(res));
  }
  const data = (await res.json()) as {
    ok?: boolean;
    error?: { message?: string };
    payload?: { requiresGatewayRestart: boolean };
  };
  if (!data.ok || !data.payload) {
    throw new Error(data.error?.message ?? 'Invalid response');
  }
  return data.payload;
}

export async function uninstallExtensionFromDisk(extensionId: string): Promise<{
  requiresGatewayRestart: boolean;
}> {
  const res = await apiFetch(apiUrl('/api/marketplace/uninstall'), {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ extensionId }),
  });
  if (!res.ok) {
    throw new Error(await readErrorMessage(res));
  }
  const data = (await res.json()) as {
    ok?: boolean;
    error?: string;
    payload?: { requiresGatewayRestart: boolean };
  };
  if (!data.ok || !data.payload) {
    throw new Error(data.error ?? 'Invalid response');
  }
  return data.payload;
}
