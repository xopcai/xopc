// @vitest-environment jsdom
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { MemoryRouter, useLocation } from 'react-router-dom';
import { SWRConfig } from 'swr';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { useLocaleStore } from '@/stores/locale-store';
import type { CapabilityCatalogItem } from '../capability-catalog';

const mocks = vi.hoisted(() => ({ catalog: vi.fn(), instances: vi.fn(), plan: vi.fn(), extensions: vi.fn() }));
vi.mock('../service-recommendation-api', () => ({ fetchServiceRecommendations: mocks.catalog }));
vi.mock('@/features/connectors/connectors-api', () => ({ fetchConnectorInstances: mocks.instances, fetchStoreConnectorInstallPlan: mocks.plan }));
vi.mock('@/lib/fetch', () => ({ fetchJson: mocks.extensions }));
vi.mock('@/features/extensions/agent-plugin-dialog', () => ({ AgentPluginDialog: ({ initialSource, extension }: { initialSource: string; extension?: { id: string } }) => <div data-testid="plugin-dialog">{initialSource}:{extension?.id}</div> }));
vi.mock('@/features/connectors/components/install-connector-dialog', () => ({ InstallConnectorDialog: ({ draft }: { draft: { store?: { packageName: string; reviewHash: string } } }) => <div data-testid="connector-dialog">{draft.store?.packageName}:{draft.store?.reviewHash}</div> }));
import { ServiceRecommendationList } from '../service-recommendation-list';

const items: CapabilityCatalogItem[] = [
  { id: 'feishu', kind: 'extension', name: '飞书', description: '飞书文档', source: 'Store', status: 'available', tags: [], href: '', service: { id: 'feishu', source: 'store-plugin' } },
  { id: 'wecom', kind: 'extension', name: '企业微信', description: '', source: 'Store', status: 'available', tags: [], href: '', service: { id: 'wecom', source: 'store-plugin' } },
  { id: 'tencent-docs', kind: 'connector', name: '腾讯文档', description: '在线文档', source: 'Store', status: 'available', tags: [], href: '', service: { id: 'tencent-docs', source: 'store-connector' } },
];

function Location() { const location = useLocation(); return <div data-testid="location">{location.pathname}{location.search}</div>; }

describe('service recommendation actions', () => {
  let container: HTMLDivElement;
  let root: Root;
  beforeEach(() => {
    vi.resetAllMocks();
    Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
    useLocaleStore.setState({ language: 'zh' });
    mocks.catalog.mockResolvedValue({ items, definitions: [], failedSources: 0 });
    mocks.instances.mockResolvedValue([]);
    mocks.extensions.mockResolvedValue({ extensions: [] });
    container = document.createElement('div');
    document.body.append(container);
    root = createRoot(container);
  });
  afterEach(() => { act(() => root.unmount()); container.remove(); });
  async function render(layout: 'list' | 'cards' = 'list') {
    await act(async () => { root.render(<SWRConfig value={{ provider: () => new Map(), dedupingInterval: 0 }}><MemoryRouter><ServiceRecommendationList layout={layout} /><Location /></MemoryRouter></SWRConfig>); });
  }
  async function clickService(name: string) {
    const article = [...container.querySelectorAll('article')].find(row => row.textContent?.includes(name));
    expect(article).toBeDefined();
    await act(async () => { article?.querySelector('button')?.click(); });
  }

  it('opens recommended Plugin cards through the plugin installer', async () => {
    await render('cards');
    await clickService('飞书');
    expect(container.querySelector('[data-testid="plugin-dialog"]')?.textContent).toBe('store:feishu:');
    expect(mocks.plan).not.toHaveBeenCalled();
  });

  it('obtains the reviewed Store connector plan before opening the connector installer', async () => {
    mocks.plan.mockResolvedValue({ packageName: 'tencent-docs', version: '1.0.0', reviewHash: 'review-hash', permissions: {}, definition: { id: 'tencent-docs', displayName: '腾讯文档', setup: {}, runtime: { type: 'mcp', serverId: 'tencent-docs' }, auth: { mode: 'none' } } });
    await render();
    await clickService('腾讯文档');
    expect(mocks.plan).toHaveBeenCalledWith('tencent-docs');
    expect(container.querySelector('[data-testid="connector-dialog"]')?.textContent).toBe('tencent-docs:review-hash');
  });

  it('does not mark an installed but unauthorized plugin as connected', async () => {
    mocks.extensions.mockResolvedValue({ extensions: [{ id: 'installed-wecom', format: 'agent-plugin', active: false, readiness: 'setup_required', authorizationStatus: 'required', provenance: { packageName: 'wecom' } }] });
    await render();
    const article = [...container.querySelectorAll('article')].find(row => row.textContent?.includes('企业微信'));
    expect(article?.querySelector('button')?.textContent).toBe('继续设置');
    await clickService('企业微信');
    expect(container.querySelector('[data-testid="plugin-dialog"]')?.textContent).toBe('store:wecom:installed-wecom');
  });

  it('opens an existing connector management entry without reinstalling', async () => {
    mocks.instances.mockResolvedValue([{ connectorId: 'tencent-docs', instanceId: 'docs-main', enabled: true, status: 'connected' }]);
    await render();
    await clickService('腾讯文档');
    expect(container.querySelector('[data-testid="location"]')?.textContent).toBe('/capabilities/connectors?tab=connected&instance=docs-main');
    expect(mocks.plan).not.toHaveBeenCalled();
  });

  it('offers retry after total catalog failure', async () => {
    mocks.catalog.mockRejectedValue(new Error('offline'));
    await render();
    expect(container.textContent).toContain('重试');
    expect(container.querySelectorAll('article')).toHaveLength(0);
  });

  it('shows skeletons without international fallback while loading', async () => {
    mocks.catalog.mockReturnValue(new Promise(() => {}));
    await render();
    expect(container.querySelector('[aria-busy="true"]')).not.toBeNull();
    expect(container.textContent).not.toContain('Gmail');
  });
});
