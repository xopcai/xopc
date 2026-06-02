import { apiFetch } from '@/lib/fetch';
import { apiUrl } from '@/lib/url';
import { useGatewayStore } from '@/stores/gateway-store';

import type {
  MarketplaceCategoryItem,
  MarketplacePackageDetailPayload,
  SkillMarkdownPreviewPayload,
  SkillsMarketplacePayload,
  SkillsPayload,
} from '@/features/skills/skill.types';

async function readErrorMessage(res: Response): Promise<string> {
  const j = (await res.json().catch(() => ({}))) as { error?: unknown };
  if (typeof j.error === 'string') return j.error;
  if (j.error && typeof j.error === 'object' && 'message' in j.error) {
    const m = (j.error as { message?: string }).message;
    if (typeof m === 'string') return m;
  }
  return `HTTP ${res.status}`;
}

export async function getSkills(lang?: string): Promise<SkillsPayload> {
  const qs = lang && lang !== 'en' ? `?lang=${encodeURIComponent(lang)}` : '';
  const res = await apiFetch(apiUrl(`/api/skills${qs}`), { cache: 'no-store' });
  if (!res.ok) {
    throw new Error(await readErrorMessage(res));
  }
  const data = (await res.json()) as { ok?: boolean; payload?: SkillsPayload };
  if (!data.payload) {
    throw new Error('Invalid response');
  }
  return data.payload;
}

export async function reloadSkills(): Promise<void> {
  const res = await apiFetch(apiUrl('/api/skills/reload'), {
    method: 'POST',
  });
  if (!res.ok) {
    throw new Error(await readErrorMessage(res));
  }
}

export async function uploadSkillZip(
  file: File,
  opts: { skillId?: string; overwrite?: boolean },
): Promise<{ skillId: string; path: string }> {
  const form = new FormData();
  form.append('file', file);
  if (opts.skillId) {
    form.append('skillId', opts.skillId);
  }
  if (opts.overwrite) {
    form.append('overwrite', 'true');
  }

  const token = useGatewayStore.getState().token;
  const headers = new Headers();
  if (token) {
    headers.set('Authorization', `Bearer ${token}`);
  }

  const res = await fetch(apiUrl('/api/skills/upload'), {
    method: 'POST',
    headers,
    body: form,
  });

  if (res.status === 401) {
    useGatewayStore.getState().onUnauthorized();
  }

  const data = (await res.json().catch(() => ({}))) as {
    ok?: boolean;
    error?: string;
    payload?: { skillId: string; path: string };
  };
  if (!res.ok) {
    throw new Error(data.error || `HTTP ${res.status}`);
  }
  if (!data.payload?.skillId) {
    throw new Error('Invalid response');
  }
  return data.payload;
}

export async function deleteSkill(skillId: string): Promise<void> {
  const res = await apiFetch(apiUrl(`/api/skills/${encodeURIComponent(skillId)}`), {
    method: 'DELETE',
  });
  if (!res.ok) {
    throw new Error(await readErrorMessage(res));
  }
}

export async function patchSkillEnabled(skillName: string, enabled: boolean): Promise<void> {
  const res = await apiFetch(apiUrl('/api/skills/enabled'), {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ skillName, enabled }),
  });
  if (!res.ok) {
    throw new Error(await readErrorMessage(res));
  }
}

function appendMarketplaceProvider(sp: URLSearchParams, provider?: string) {
  if (provider?.trim()) {
    sp.set('provider', provider.trim());
  }
}

export async function getMarketplaceCategories(opts?: {
  provider?: string;
}): Promise<{ items: MarketplaceCategoryItem[] }> {
  const sp = new URLSearchParams();
  appendMarketplaceProvider(sp, opts?.provider);
  const qs = sp.toString();
  const res = await apiFetch(apiUrl(`/api/skills/marketplace/categories${qs ? `?${qs}` : ''}`), {
    cache: 'no-store',
  });
  if (!res.ok) {
    throw new Error(await readErrorMessage(res));
  }
  const data = (await res.json()) as { ok?: boolean; payload?: { items?: MarketplaceCategoryItem[] } };
  if (!data.payload || !Array.isArray(data.payload.items)) {
    throw new Error('Invalid response');
  }
  return { items: data.payload.items };
}

export async function getMarketplaceSkills(params: {
  q?: string;
  page?: number;
  pageSize?: number;
  sort?: 'downloads' | 'newest';
  category?: string;
  provider?: string;
  /** Optional caller-provided abort signal — used by aggregated search to enforce a per-provider
   *  timeout so a third-party adapter that hangs cannot pin its tab on "loading" forever. */
  signal?: AbortSignal;
}): Promise<SkillsMarketplacePayload & { provider?: string }> {
  const sp = new URLSearchParams();
  if (params.q?.trim()) sp.set('q', params.q.trim());
  if (params.page != null) sp.set('page', String(params.page));
  if (params.pageSize != null) sp.set('pageSize', String(params.pageSize));
  if (params.sort) sp.set('sort', params.sort);
  if (params.category?.trim()) sp.set('category', params.category.trim());
  appendMarketplaceProvider(sp, params.provider);
  const qs = sp.toString();
  const res = await apiFetch(apiUrl(`/api/skills/marketplace${qs ? `?${qs}` : ''}`), {
    cache: 'no-store',
    signal: params.signal,
  });
  if (!res.ok) {
    throw new Error(await readErrorMessage(res));
  }
  const data = (await res.json()) as { ok?: boolean; payload?: SkillsMarketplacePayload & { provider?: string } };
  if (!data.payload?.items || !data.payload.meta) {
    throw new Error('Invalid response');
  }
  return data.payload;
}

export async function getMarketplacePackageDetail(
  packageName: string,
  opts?: { provider?: string },
): Promise<MarketplacePackageDetailPayload> {
  const enc = encodeURIComponent(packageName);
  const sp = new URLSearchParams();
  appendMarketplaceProvider(sp, opts?.provider);
  const qs = sp.toString();
  const res = await apiFetch(apiUrl(`/api/skills/marketplace/packages/${enc}${qs ? `?${qs}` : ''}`), {
    cache: 'no-store',
  });
  if (!res.ok) {
    throw new Error(await readErrorMessage(res));
  }
  const data = (await res.json()) as { ok?: boolean; payload?: MarketplacePackageDetailPayload };
  if (!data.payload?.name) {
    throw new Error('Invalid response');
  }
  return data.payload;
}

export async function installMarketplaceSkill(opts: {
  name: string;
  version?: string;
  overwrite?: boolean;
  provider?: string;
}): Promise<{ skillId: string; path: string }> {
  const res = await apiFetch(apiUrl('/api/skills/marketplace/install'), {
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
    payload?: { skillId: string; path: string };
  };
  if (!data.payload?.skillId) {
    throw new Error(data.error || 'Invalid response');
  }
  return data.payload;
}

export async function getSkillMarkdown(skillName: string, lang?: string): Promise<SkillMarkdownPreviewPayload> {
  const qs = lang ? `?lang=${encodeURIComponent(lang)}` : '';
  const res = await apiFetch(apiUrl(`/api/skills/${encodeURIComponent(skillName)}/content${qs}`), {
    cache: 'no-store',
  });
  if (!res.ok) {
    throw new Error(await readErrorMessage(res));
  }
  const data = (await res.json()) as { ok?: boolean; payload?: SkillMarkdownPreviewPayload };
  const p = data.payload;
  if (
    !p ||
    typeof p.name !== 'string' ||
    typeof p.description !== 'string' ||
    typeof p.bodyMarkdown !== 'string' ||
    typeof p.disableModelInvocation !== 'boolean' ||
    !p.metadata ||
    typeof p.metadata !== 'object' ||
    typeof p.metadata.name !== 'string' ||
    typeof p.metadata.description !== 'string'
  ) {
    throw new Error('Invalid response');
  }
  return p;
}

export interface MarketplaceProviderInfo {
  provider: string;
  displayName: string;
}

export async function getMarketplaceProvider(): Promise<MarketplaceProviderInfo> {
  const res = await apiFetch(apiUrl('/api/skills/marketplace/provider'), {
    cache: 'no-store',
  });
  if (!res.ok) {
    throw new Error(await readErrorMessage(res));
  }
  const data = (await res.json()) as { ok?: boolean; payload?: MarketplaceProviderInfo };
  if (!data.payload?.provider) {
    throw new Error('Invalid response');
  }
  return data.payload;
}

/** All registered marketplace providers (built-in + extension-contributed). */
export async function getMarketplaceProviders(): Promise<{
  providers: Array<{ id: string; displayName: string }>;
  current: string;
}> {
  const res = await apiFetch(apiUrl('/api/skills/marketplace/providers'), {
    cache: 'no-store',
  });
  if (!res.ok) {
    throw new Error(await readErrorMessage(res));
  }
  const data = (await res.json()) as {
    ok?: boolean;
    payload?: { providers: Array<{ id: string; displayName: string }>; current: string };
  };
  if (!data.payload?.providers) {
    throw new Error('Invalid response');
  }
  return data.payload;
}
