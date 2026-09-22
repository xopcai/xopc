// @vitest-environment jsdom
import { act, type ReactNode } from 'react';
import { createRoot } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({ resolve: vi.fn(), confirm: vi.fn(), router: { registerIframe: vi.fn(), unregisterIframe: vi.fn(),
  subscribeExtensionEvents: vi.fn(() => () => {}), sendEvent: vi.fn(), sendInit: vi.fn() } }));
vi.mock('../extension-authoritative-grants', () => ({ resolveExtensionUiGrant: mocks.resolve, confirmExtensionUiGrant: mocks.confirm }));
vi.mock('../extension-provider', () => ({ useExtensionRouter: () => mocks.router }));
vi.mock('../extension-permission-dialog', () => ({ ExtensionPermissionDialog: (props: { permissions: string[]; confirmDisabled?: boolean; onConfirm: () => void }) =>
  <button disabled={props.confirmDisabled} onClick={props.onConfirm}>Allow {props.permissions.join(',')}</button> }));
import { ExtensionIframeHost } from '../extension-iframe-host';

const digest = 'a'.repeat(64);
const grant = { extensionId: 'fixture', granted: false, manifestDigest: digest, permissions: ['theme'] };
let container: HTMLDivElement;
let root: ReturnType<typeof createRoot>;
beforeEach(() => {
  (globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
  vi.clearAllMocks(); mocks.resolve.mockResolvedValue(grant);
  container = document.createElement('div'); document.body.append(container); root = createRoot(container);
});
afterEach(async () => { await act(async () => root.unmount()); container.remove(); });
async function render(node: ReactNode) { await act(async () => root.render(node)); }
const button = () => container.querySelector('button')!;
describe('extension grant review', () => {
  it('shows authoritative permissions and confirms the exact reviewed digest', async () => {
    mocks.confirm.mockResolvedValue({ ...grant, granted: true });
    await render(<ExtensionIframeHost extensionId="fixture" entrypoint="ui/index.html" permissions={['config.write']} />);
    expect(button().textContent).toBe('Allow theme');
    await act(async () => button().click());
    expect(mocks.router.registerIframe).toHaveBeenCalledWith('fixture', expect.any(HTMLIFrameElement), ['theme'], digest);
    expect(mocks.confirm).toHaveBeenCalledWith('fixture', digest);
  });
  it('blocks confirmation when the manifest cannot be verified', async () => {
    mocks.resolve.mockResolvedValue({ ...grant, manifestDigest: undefined });
    await render(<ExtensionIframeHost extensionId="fixture" entrypoint="ui/index.html" />);
    expect(button().disabled).toBe(true);
    await act(async () => button().click());
    expect(mocks.confirm).not.toHaveBeenCalled();
  });
  it('does not authorize a new extension with a late confirmation from the previous one', async () => {
    let resolve!: (value: unknown) => void;
    mocks.confirm.mockReturnValue(new Promise(done => { resolve = done; }));
    await render(<ExtensionIframeHost extensionId="fixture" entrypoint="ui/index.html" />);
    await act(async () => button().click());
    mocks.resolve.mockResolvedValue({ ...grant, extensionId: 'other' });
    await render(<ExtensionIframeHost extensionId="other" entrypoint="ui/index.html" />);
    await act(async () => { resolve({ ...grant, granted: true }); });
    expect(mocks.router.registerIframe).not.toHaveBeenCalled();
  });
});
