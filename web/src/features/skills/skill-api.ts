import { apiFetch } from '@/lib/fetch';
import { apiUrl } from '@/lib/url';
import { useGatewayStore } from '@/stores/gateway-store';

import { getSkills } from '@/features/skills/skill-list-api';
import { reloadSkills } from '@/features/skills/skill-reload-api';
import { readSkillApiErrorMessage } from '@/features/skills/skill-api-utils';

import type {
  MarketplaceCategoryItem,
  MarketplacePackageDetailPayload,
  SkillDiagnostic,
  SkillInstallTarget,
  SkillInstallResultPayload,
  SkillMarkdownPreviewPayload,
  SkillRuntimeStatus,
  SkillSourceInstallResultPayload,
  SkillsMarketplacePayload,
} from '@/features/skills/skill.types';

export { getSkills, reloadSkills };

export async function uploadSkillZip(
  file: File,
  opts: { skillId?: string; overwrite?: boolean; target?: SkillInstallTarget },
): Promise<SkillInstallResultPayload> {
  const form = new FormData();
  form.append('file', file);
  if (opts.skillId) {
    form.append('skillId', opts.skillId);
  }
  if (opts.overwrite) {
    form.append('overwrite', 'true');
  }
  form.append('target', opts.target ?? 'global');

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
    payload?: SkillInstallResultPayload;
  };
  if (!res.ok) {
    throw new Error(data.error || `HTTP ${res.status}`);
  }
  if (!data.payload?.skillId) {
    throw new Error('Invalid response');
  }
  return data.payload;
}

export async function deleteSkill(skillId: string, target?: SkillInstallTarget): Promise<void> {
  const qs = target ? `?target=${encodeURIComponent(target)}` : '';
  const res = await apiFetch(apiUrl(`/api/skills/${encodeURIComponent(skillId)}${qs}`), {
    method: 'DELETE',
  });
  if (!res.ok) {
    throw new Error(await readSkillApiErrorMessage(res));
  }
}

export async function patchSkillEnabled(skillName: string, enabled: boolean): Promise<void> {
  const res = await apiFetch(apiUrl('/api/skills/enabled'), {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ skillName, enabled }),
  });
  if (!res.ok) {
    throw new Error(await readSkillApiErrorMessage(res));
  }
}

function appendMarketplaceProvider(sp: URLSearchParams, provider?: string) {
  if (provider?.trim()) {
    sp.set('provider', provider.trim());
  }
}

export async function getMarketplaceCategories(opts?: {
  provider?: string;
  locale?: string;
}): Promise<{ items: MarketplaceCategoryItem[] }> {
  const sp = new URLSearchParams();
  appendMarketplaceProvider(sp, opts?.provider);
  if (opts?.locale?.trim()) sp.set('locale', opts.locale.trim());
  const qs = sp.toString();
  const res = await apiFetch(apiUrl(`/api/skills/marketplace/categories${qs ? `?${qs}` : ''}`), {
    cache: 'no-store',
  });
  if (!res.ok) {
    throw new Error(await readSkillApiErrorMessage(res));
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
    throw new Error(await readSkillApiErrorMessage(res));
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
    throw new Error(await readSkillApiErrorMessage(res));
  }
  const data = (await res.json()) as { ok?: boolean; payload?: MarketplacePackageDetailPayload };
  const p = data.payload;
  if (
    !p?.name ||
    !p.skillDocPreview ||
    typeof p.skillDocPreview.name !== 'string' ||
    typeof p.skillDocPreview.description !== 'string' ||
    typeof p.skillDocPreview.bodyMarkdown !== 'string' ||
    typeof p.skillDocPreview.disableModelInvocation !== 'boolean' ||
    !p.skillDocPreview.metadata ||
    typeof p.skillDocPreview.metadata !== 'object' ||
    typeof p.skillDocPreview.metadata.name !== 'string' ||
    typeof p.skillDocPreview.metadata.description !== 'string'
  ) {
    throw new Error('Invalid response');
  }
  return p;
}

export async function installMarketplaceSkill(opts: {
  name: string;
  version?: string;
  overwrite?: boolean;
  provider?: string;
  target?: SkillInstallTarget;
}): Promise<SkillInstallResultPayload> {
  const res = await apiFetch(apiUrl('/api/skills/marketplace/install'), {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ target: 'global', ...opts }),
  });
  if (!res.ok) {
    throw new Error(await readSkillApiErrorMessage(res));
  }
  const data = (await res.json()) as {
    ok?: boolean;
    error?: string;
    payload?: SkillInstallResultPayload;
  };
  if (!data.payload?.skillId) {
    throw new Error(data.error || 'Invalid response');
  }
  return data.payload;
}

export async function installSkillFromSource(opts: {
  source: string;
  ref?: string;
  path?: string;
  skillId?: string;
  target?: SkillInstallTarget;
  force?: boolean;
  strictScan?: boolean;
}): Promise<SkillSourceInstallResultPayload> {
  const res = await apiFetch(apiUrl('/api/skills/hub/install'), {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ target: 'global', ...opts }),
  });
  if (!res.ok) {
    throw new Error(await readSkillApiErrorMessage(res));
  }
  const data = (await res.json()) as {
    ok?: boolean;
    error?: string;
    payload?: SkillSourceInstallResultPayload;
  };
  if (!data.payload?.skillId) {
    throw new Error(data.error || 'Invalid response');
  }
  return data.payload;
}

export async function getSkillMarkdown(skillName: string): Promise<SkillMarkdownPreviewPayload> {
  const res = await apiFetch(apiUrl(`/api/skills/${encodeURIComponent(skillName)}/content`), {
    cache: 'no-store',
  });
  if (!res.ok) {
    throw new Error(await readSkillApiErrorMessage(res));
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
    throw new Error(await readSkillApiErrorMessage(res));
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
    throw new Error(await readSkillApiErrorMessage(res));
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

export async function getSkillsStatus(): Promise<{
  version: string;
  loadedAt: number;
  diagnostics: SkillDiagnostic[];
  status: SkillRuntimeStatus;
}> {
  const res = await apiFetch(apiUrl('/api/skills/status'), {
    cache: 'no-store',
  });
  if (!res.ok) {
    throw new Error(await readSkillApiErrorMessage(res));
  }
  const data = (await res.json()) as {
    ok?: boolean;
    payload?: {
      version: string;
      loadedAt: number;
      diagnostics: SkillDiagnostic[];
      status: SkillRuntimeStatus;
    };
  };
  if (!data.payload?.status) {
    throw new Error('Invalid response');
  }
  return data.payload;
}
