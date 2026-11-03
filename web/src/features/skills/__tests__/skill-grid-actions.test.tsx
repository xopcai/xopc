// @vitest-environment jsdom
import { act, type ComponentProps } from 'react';
import { createRoot } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import type { SkillCatalogEntry } from '@/features/skills/skill.types';
import { SkillsPageCatalogContent } from '@/features/skills/skills-page-catalog-content';
import { SkillsPageMarketplaceContent } from '@/features/skills/skills-page-marketplace-content';
import { messages } from '@/i18n/messages';

const sk = messages('zh').skills;
const skill: SkillCatalogEntry = {
  name: 'spreadsheets', directoryId: 'spreadsheets', description: '创建和编辑电子表格',
  source: 'builtin', origin: 'bundled', path: '/skills/spreadsheets',
  managed: false, writable: false, enabled: true, disableModelInvocation: false,
};

describe('skill grid actions', () => {
  let host: HTMLDivElement;
  let root: ReturnType<typeof createRoot>;

  beforeEach(() => {
    Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
    host = document.createElement('div');
    document.body.append(host);
    root = createRoot(host);
  });
  afterEach(() => {
    act(() => root.unmount());
    host.remove();
  });

  function catalogProps(row = skill): ComponentProps<typeof SkillsPageCatalogContent> {
    return {
      sk, loading: false, catalog: [row], filteredCatalog: [row], catalogDisplayRows: [row],
      builtinCategories: [], builtinCategoryFilter: '', setBuiltinCategoryFilter: vi.fn(),
      catalogStatusFilter: 'all', resolveSkillEnabled: (entry) => entry.enabled,
      skillPresentation: (entry) => ({ displayName: entry.name, description: entry.description, aliases: [], searchTerms: [] }),
      categoryLabel: (category) => category, sourceLabel: () => '内置',
      openSkillDetail: vi.fn(), onSkillToggle: vi.fn(), onUseSkillInChat: vi.fn(),
      usingSkillInChatName: null, togglingSkillName: null, findingSkills: false, onFindSkills: vi.fn(),
    };
  }

  it('keeps using a skill separate from opening its complete description', async () => {
    const props = catalogProps();
    await act(async () => root.render(<SkillsPageCatalogContent {...props} />));
    const action = host.querySelector<HTMLButtonElement>('button[aria-label="使用 spreadsheets"]')!;
    await act(async () => action.click());
    expect(props.onUseSkillInChat).toHaveBeenCalledExactlyOnceWith({ name: skill.name, source: 'catalog' });
    expect(props.openSkillDetail).not.toHaveBeenCalled();
    act(() => host.querySelector<HTMLButtonElement>('h3 button')!.click());
    expect(props.openSkillDetail).toHaveBeenCalledExactlyOnceWith(skill);
    expect(host.textContent).toContain(skill.description);
    expect(host.textContent).not.toContain(sk.statusEnabled);
  });

  it('routes plugin authorization through the existing use action', async () => {
    const row: SkillCatalogEntry = {
      ...skill, source: 'global', origin: 'plugin:lark',
      plugin: { id: 'lark', name: 'Lark', title: '飞书', active: true, authorizationStatus: 'required', readiness: 'degraded' },
    };
    const props = catalogProps(row);
    await act(async () => root.render(<SkillsPageCatalogContent {...props} />));
    await act(async () => host.querySelector<HTMLButtonElement>('button[aria-label="授权 spreadsheets"]')!.click());
    expect(props.onUseSkillInChat).toHaveBeenCalledExactlyOnceWith({ name: row.name, source: 'catalog' });
    expect(props.onSkillToggle).not.toHaveBeenCalled();
    expect(host.textContent).toContain('飞书');
    expect(host.textContent).not.toContain('需要授权');
  });

  it('enables a disabled skill without starting a chat', async () => {
    const props = catalogProps({ ...skill, enabled: false });
    await act(async () => root.render(<SkillsPageCatalogContent {...props} />));
    await act(async () => host.querySelector<HTMLButtonElement>('button[aria-label="启用 spreadsheets"]')!.click());
    expect(props.onSkillToggle).toHaveBeenCalledExactlyOnceWith(skill.name, true);
    expect(props.onUseSkillInChat).not.toHaveBeenCalled();
  });

  it.each([false, true])('preserves the marketplace provider for installed=%s', async (installed) => {
    const props: ComponentProps<typeof SkillsPageMarketplaceContent> = {
      sk, findingSkills: false, onFindSkills: vi.fn(),
      mpCategories: [], mpCategoriesLoading: false, mpCategoriesError: null,
      mpPayload: {
        items: [{ id: 'sheet-tools', name: 'Sheet tools', type: 'skill', description: 'Edit spreadsheets', downloads: 1234, updatedAt: '2026-11-03T00:00:00Z', author: { username: 'demo', avatarUrl: null }, providerId: 'skillhub' }],
        meta: { page: 1, pageSize: 20, total: 1, totalPages: 1 },
      },
      mpLoading: false, mpError: null, marketCategoryId: '', setMarketCategoryId: vi.fn(),
      mpHasMore: false, onLoadMoreMarket: vi.fn(), onRetryMarket: vi.fn(),
      isSkillInstalledByName: () => installed, openMarketplaceDetail: vi.fn(),
      onMarketInstall: vi.fn(), installingMarketName: null, onUseSkillInChat: vi.fn(), usingSkillInChatName: null,
      searchInputActive: false, searchQuery: '', setSearchQuery: vi.fn(), registeredProviders: [],
      marketplacePresentation: (row) => ({ displayName: row.name, description: row.description, aliases: [], searchTerms: [] }),
      marketBrowseProvider: 'store', setMarketBrowseProvider: vi.fn(),
    };
    await act(async () => root.render(<SkillsPageMarketplaceContent {...props} />));
    const action = host.querySelector<HTMLButtonElement>(`button[aria-label="${installed ? sk.previewUseInChat : sk.marketplaceInstall} Sheet tools"]`)!;
    await act(async () => action.click());
    if (installed) {
      expect(props.onUseSkillInChat).toHaveBeenCalledExactlyOnceWith({ name: 'sheet-tools', source: 'store', providerOverride: 'skillhub' });
      expect(props.onMarketInstall).not.toHaveBeenCalled();
    } else {
      expect(props.onMarketInstall).toHaveBeenCalledExactlyOnceWith('sheet-tools', { providerOverride: 'skillhub' });
      expect(props.onUseSkillInChat).not.toHaveBeenCalled();
    }
    expect(props.openMarketplaceDetail).not.toHaveBeenCalled();
  });
});
