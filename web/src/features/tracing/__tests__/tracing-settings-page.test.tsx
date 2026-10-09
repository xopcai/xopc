// @vitest-environment jsdom

import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const { queries, request, credentialState, copy } = vi.hoisted(() => ({ queries: [] as URLSearchParams[], request: vi.fn(), credentialState: { configured: false }, copy: vi.fn(async () => true) }));
vi.mock('@/lib/copy-to-clipboard', () => ({ copyTextToClipboard: copy }));
vi.mock('@/stores/locale-store', () => ({ useLocaleStore: (selector: (state: { language: string }) => unknown) => selector({ language: 'en' }) }));
vi.mock('../tracing-api', () => ({ traceUrl: (path: string) => `http://localhost/api/observability/${path}`, traceRequest: request }));
vi.mock('@/components/ui/popover-select', () => ({
  PopoverSelect: ({ value, options, onChange }: { value: string; options: { value: string; label: string }[]; onChange: (value: string) => void }) => <select value={value} onChange={event => onChange(event.target.value)}>{options.map(option => <option key={option.value} value={option.value}>{option.label}</option>)}</select>,
}));
vi.mock('swr', () => ({ default: (key: string | null) => {
  if (!key) return { data: undefined };
  const url = new URL(key);
  let data: unknown;
  if (url.pathname.endsWith('/traces')) {
    queries.push(url.searchParams);
    const start = Number(url.searchParams.get('cursor') ?? '0');
    const count = Number(url.searchParams.get('limit'));
    data = { traces: Array.from({ length: Math.min(count, 25 - start) }, (_, offset) => ({ traceId: String(start + offset), spanId: 'test', name: `Run ${start + offset + 1}`, type: 'agent', status: 'success', startedAt: 1000, endedAt: 1100, attributes: {} })), nextCursor: start + count < 25 ? String(start + count) : null };
  } else if (url.pathname.endsWith('/settings')) {
    data = { config: { enabled: true, capture: 'redacted', local: { retentionDays: 7, maxStoreMiB: 256, maxTraces: 10000, maxSpans: 100000, maxTraceKiB: 1024, maxWriteMiBPerMinute: 2 }, langfuse: { enabled: false, baseUrl: 'https://cloud.langfuse.com' } }, credentials: { publicKeyConfigured: credentialState.configured, secretKeyConfigured: credentialState.configured, publicKeySource: 'none', secretKeySource: 'none', baseUrlSource: 'config' } };
  } else {
    data = { local: { physicalBytes: 0, bytes: 0, traces: 25, spans: 25 }, langfuse: { state: 'disabled', pending: 0, dropped: 0 } };
  }
  return { data, isValidating: false, mutate: vi.fn(async () => {}) };
} }));

import { TracingSettingsPage } from '../tracing-settings-page';

let container: HTMLDivElement;
let root: ReturnType<typeof createRoot>;
function button(label: string) {
  const result = [...container.querySelectorAll<HTMLButtonElement>('button')].find(item => item.textContent === label);
  if (!result) throw new Error(`Missing button: ${label}`);
  return result;
}
const results = () => container.querySelector('[aria-label="Execution results"]')!;

beforeEach(() => {
  (globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
  queries.length = 0;
  credentialState.configured = false;
  copy.mockClear();
  request.mockReset();
  request.mockImplementation(async (_path: string, method: string, body: unknown) => method === 'PATCH' ? { config: body } : { ok: true });
  container = document.createElement('div'); document.body.append(container); root = createRoot(container);
  act(() => root.render(<TracingSettingsPage />));
});
afterEach(() => { act(() => root.unmount()); container.remove(); vi.restoreAllMocks(); vi.useRealTimers(); });

describe('tracing records navigation', () => {
  it('replaces each bounded page and supports backward navigation and the last page', () => {
    expect(results().querySelectorAll('button')).toHaveLength(10);
    expect(results().className).toContain('overflow-y-auto');
    expect(results().className).toContain('h-[24rem]');
    expect(button('Previous page').disabled).toBe(true);
    const cutoff = queries.at(-1)!.get('to');
    act(() => button('Next page').click());
    expect(results().querySelector('button')?.textContent).toContain('Run 11');
    expect(results().querySelectorAll('button')).toHaveLength(10);
    expect(queries.at(-1)!.get('to')).toBe(cutoff);
    act(() => button('Next page').click());
    expect(results().querySelectorAll('button')).toHaveLength(5);
    expect(button('Next page').disabled).toBe(true);
    act(() => button('Previous page').click());
    expect(results().querySelector('button')?.textContent).toContain('Run 11');
  });
  it('resets the cursor when page size or filters change', () => {
    act(() => button('Next page').click());
    const pageSize = [...container.querySelectorAll<HTMLSelectElement>('select')].find(select => [...select.options].some(option => option.text === '20 records'))!;
    act(() => { pageSize.value = '20'; pageSize.dispatchEvent(new Event('change', { bubbles: true })); });
    expect(results().querySelectorAll('button')).toHaveLength(20);
    expect(button('Previous page').disabled).toBe(true);
    expect(queries.at(-1)!.get('cursor')).toBeNull();
    act(() => button('Next page').click());
    const status = container.querySelector('select')!;
    act(() => { status.value = 'error'; status.dispatchEvent(new Event('change', { bubbles: true })); });
    expect(queries.at(-1)!.get('status')).toBe('error');
    expect(queries.at(-1)!.get('cursor')).toBeNull();
  });
  it('separates execution records from editable capture settings', () => {
    expect(container.textContent).not.toContain('Storage budget (MiB)');
    act(() => button('Capture settings').click());
    expect(container.textContent).toContain('Storage budget (MiB)');
    expect(container.querySelector('[aria-label="Execution results"]')).toBeNull();
    expect([...container.querySelectorAll('button')].some(item => item.textContent === 'Save')).toBe(false);
    expect(container.textContent).toContain('Changes save automatically');
    act(() => button('Execution records').click());
    expect(results()).not.toBeNull();
    expect(container.textContent).not.toContain('Storage budget (MiB)');
  });
});


describe('tracing autosave', () => {
  it('persists config edits automatically without a save button', async () => {
    vi.useFakeTimers();
    act(() => button('Capture settings').click());
    act(() => container.querySelector<HTMLInputElement>('input[type="checkbox"]')!.click());
    expect(request).not.toHaveBeenCalled();
    await act(async () => { await vi.advanceTimersByTimeAsync(750); });
    expect(request).toHaveBeenCalledWith('tracing/settings', 'PATCH', expect.objectContaining({ enabled: false }));
    expect(container.textContent).toContain('Saved automatically');
  });
  it('automatically saves entered credentials and clears them after success', async () => {
    vi.useFakeTimers();
    act(() => button('Capture settings').click());
    const secret = container.querySelector<HTMLInputElement>('#langfuse-secretKey')!;
    const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!;
    act(() => { setter.call(secret, 'sk-lf-test-key'); secret.dispatchEvent(new Event('input', { bubbles: true })); });
    await act(async () => { await vi.advanceTimersByTimeAsync(1100); });
    expect(request).toHaveBeenCalledWith('tracing/langfuse/credentials', 'PUT', { secretKey: 'sk-lf-test-key' });
    expect(container.querySelector<HTMLInputElement>('#langfuse-secretKey')!.value).toBe('');
  });
  it('preserves newer edits while an earlier automatic save is still in flight', async () => {
    vi.useFakeTimers();
    let finishFirst!: (value: unknown) => void;
    request.mockImplementationOnce(() => new Promise(resolve => { finishFirst = resolve; }));
    act(() => button('Capture settings').click());
    const checkbox = container.querySelector<HTMLInputElement>('input[type="checkbox"]')!;
    act(() => checkbox.click());
    await act(async () => { await vi.advanceTimersByTimeAsync(750); });
    const first = request.mock.calls[0][2];
    act(() => checkbox.click());
    await act(async () => { finishFirst({ config: first }); await Promise.resolve(); });
    expect(checkbox.checked).toBe(true);
    await act(async () => { await vi.advanceTimersByTimeAsync(750); });
    expect(request).toHaveBeenLastCalledWith('tracing/settings', 'PATCH', expect.objectContaining({ enabled: true }));
  });
  it('keeps failed edits visible and exposes an automatic-save retry', async () => {
    vi.useFakeTimers(); request.mockRejectedValue(new Error('Connection unavailable'));
    act(() => button('Capture settings').click());
    act(() => container.querySelector<HTMLInputElement>('input[type="checkbox"]')!.click());
    await act(async () => { await vi.advanceTimersByTimeAsync(750); });
    expect(container.querySelector<HTMLInputElement>('input[type="checkbox"]')!.checked).toBe(false);
    expect(container.textContent).toContain('Connection unavailable');
    expect(button('Retry autosave')).toBeDefined();
  });
});


describe('Langfuse key viewing and copying', () => {
  it.each(['publicKey', 'secretKey'] as const)('reveals, hides and copies configured %s without saving it', async field => {
    credentialState.configured = true;
    const label = field === 'publicKey' ? 'Public Key' : 'Secret Key';
    request.mockResolvedValue({ key: 'configured-test-key' });
    act(() => button('Capture settings').click());
    const input = () => container.querySelector<HTMLInputElement>(`#langfuse-${field}`)!;
    expect(input().type).toBe('password');
    expect(request).not.toHaveBeenCalled();
    await act(async () => container.querySelector<HTMLButtonElement>(`button[aria-label="Copy ${label}"]`)!.click());
    expect(copy).toHaveBeenCalledWith('configured-test-key');
    expect(input().type).toBe('password');
    expect(input().value).not.toBe('configured-test-key');
    await act(async () => container.querySelector<HTMLButtonElement>(`button[aria-label="Show ${label}"]`)!.click());
    expect(input().type).toBe('text');
    expect(input().value).toBe('configured-test-key');
    act(() => container.querySelector<HTMLButtonElement>(`button[aria-label="Hide ${label}"]`)!.click());
    expect(input().type).toBe('password');
    expect(request.mock.calls).toEqual([[`tracing/langfuse/credentials/${field}/reveal`, 'POST']]);
  });
  it('shows reveal failures without copying a masked placeholder', async () => {
    credentialState.configured = true;
    request.mockRejectedValue(new Error('Reveal unavailable'));
    act(() => button('Capture settings').click());
    await act(async () => container.querySelector<HTMLButtonElement>('button[aria-label="Copy Secret Key"]')!.click());
    expect(copy).not.toHaveBeenCalled();
    expect(container.textContent).toContain('Reveal unavailable');
  });
});
