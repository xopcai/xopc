// @vitest-environment jsdom
import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { MemoryRouter } from 'react-router-dom';
import { expect, it, vi } from 'vitest';
import type { SkillCatalogEntry } from '../skill.types';
import { PluginSkillOwner, pluginSkillUnavailable } from '../plugin-skill-owner';

vi.mock('@/stores/locale-store', () => ({ useLocaleStore: (select: (s: { language: string }) => unknown) => select({ language: 'zh' }) }));
Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
it('links unavailable skills to owner authorization and explains package management', async () => {
  const skill: SkillCatalogEntry = { directoryId: 'sample', name: 'demo.sample', description: '', source: 'global', path: '', managed: false, writable: false, enabled: true, disableModelInvocation: false, origin: 'plugin:demo', plugin: { id: 'demo', name: 'Demo', active: true, authorizationStatus: 'required', readiness: 'degraded' } };
  expect(pluginSkillUnavailable(skill)).toBe(true);
  expect(pluginSkillUnavailable({ ...skill, plugin: { ...skill.plugin!, authorizationStatus: 'connected' } })).toBe(false);
  const host = document.createElement('div'); const root = createRoot(host);
  try {
    await act(async () => root.render(<MemoryRouter initialEntries={['/capabilities/skills?source=plugin&q=Demo']}><PluginSkillOwner skill={skill} detail /></MemoryRouter>));
    expect(host.textContent).toContain('统一更新和卸载');
    expect(host.querySelector('a')?.getAttribute('href')).toBe('/capabilities/skills?source=plugin&q=Demo&plugin=demo&connect=1');
    expect(host.querySelector('button')).toBeNull();
  } finally { await act(async () => root.unmount()); }
});
