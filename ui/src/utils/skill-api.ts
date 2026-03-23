// Skills API — managed global skills (~/.xopcbot/skills)

export interface SkillCatalogEntry {
  directoryId: string;
  name: string;
  description: string;
  source: 'builtin' | 'workspace' | 'global';
  path: string;
  managed: boolean;
}

export interface ManagedSkillDir {
  id: string;
  name: string;
  description: string;
  path: string;
}

export interface SkillsPayload {
  catalog: SkillCatalogEntry[];
  managed: ManagedSkillDir[];
}

export class SkillAPIClient {
  private baseUrl: string;
  private token?: string;

  constructor(baseUrl: string, token?: string) {
    this.baseUrl = baseUrl.replace(/\/$/, '');
    this.token = token;
  }

  private authHeaders(): Record<string, string> {
    const h: Record<string, string> = {};
    if (this.token) {
      h['Authorization'] = `Bearer ${this.token}`;
    }
    return h;
  }

  async getSkills(): Promise<SkillsPayload> {
    const res = await fetch(`${this.baseUrl}/api/skills`, {
      headers: this.authHeaders(),
    });
    if (!res.ok) {
      const err = await res.json().catch(() => ({}));
      throw new Error((err as { error?: string }).error || `HTTP ${res.status}`);
    }
    const data = (await res.json()) as { ok?: boolean; payload?: SkillsPayload };
    if (!data.payload) {
      throw new Error('Invalid response');
    }
    return data.payload;
  }

  async reloadSkills(): Promise<void> {
    const res = await fetch(`${this.baseUrl}/api/skills/reload`, {
      method: 'POST',
      headers: { ...this.authHeaders(), 'Content-Type': 'application/json' },
    });
    if (!res.ok) {
      const err = await res.json().catch(() => ({}));
      throw new Error((err as { error?: string }).error || `HTTP ${res.status}`);
    }
  }

  async uploadSkillZip(file: File, opts: { skillId?: string; overwrite?: boolean }): Promise<{
    skillId: string;
    path: string;
  }> {
    const form = new FormData();
    form.append('file', file);
    if (opts.skillId) {
      form.append('skillId', opts.skillId);
    }
    if (opts.overwrite) {
      form.append('overwrite', 'true');
    }
    const res = await fetch(`${this.baseUrl}/api/skills/upload`, {
      method: 'POST',
      headers: this.authHeaders(),
      body: form,
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) {
      throw new Error((data as { error?: string }).error || `HTTP ${res.status}`);
    }
    const payload = (data as { payload?: { skillId: string; path: string } }).payload;
    if (!payload?.skillId) {
      throw new Error('Invalid response');
    }
    return payload;
  }

  async deleteSkill(skillId: string): Promise<void> {
    const res = await fetch(`${this.baseUrl}/api/skills/${encodeURIComponent(skillId)}`, {
      method: 'DELETE',
      headers: this.authHeaders(),
    });
    if (!res.ok) {
      const err = await res.json().catch(() => ({}));
      throw new Error((err as { error?: string }).error || `HTTP ${res.status}`);
    }
  }
}
