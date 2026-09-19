import { beforeEach, describe, expect, it, vi } from 'vitest';
import { formatMobilePairingInvitation, MOBILE_PAIRING_INVITATION_VERSION } from '@xopcai/gateway-contract';

const native = vi.hoisted(() => ({ clipboard: vi.fn(), pick: vi.fn(), scan: vi.fn() }));
vi.mock('expo-clipboard', () => ({ getStringAsync: native.clipboard }));
vi.mock('expo-image-picker', () => ({ launchImageLibraryAsync: native.pick }));
vi.mock('expo-camera', () => ({ scanFromURLAsync: native.scan }));

import { readGatewayPairingInput } from '../gateway-pairing-input';

function link(overrides: Record<string, unknown> = {}): string {
  const payload = {
    version: MOBILE_PAIRING_INVITATION_VERSION,
    pairingToken: `xopc_pair_00000000-0000-4000-8000-000000000000_${'A'.repeat(43)}`,
    gatewayId: '00000000-0000-4000-8000-000000000000',
    gatewayPublicKey: 'A'.repeat(43), expiresAt: Date.now() + 60_000,
    origins: ['https://computer.example'],
    ...overrides,
  };
  return formatMobilePairingInvitation(payload as Parameters<typeof formatMobilePairingInvitation>[0]);
}

describe('gateway pairing input', () => {
  beforeEach(() => {
    native.clipboard.mockReset();
    native.pick.mockReset().mockResolvedValue({ canceled: false, assets: [{ uri: 'file:///qr.png' }] });
    native.scan.mockReset();
  });

  it('reads a copied pairing link including surrounding whitespace', async () => {
    native.clipboard.mockResolvedValue(` \n${link()}\n`);
    await expect(readGatewayPairingInput('clipboard')).resolves.toMatchObject({ version: 4, gatewayId: '00000000-0000-4000-8000-000000000000' });
    expect(native.pick).not.toHaveBeenCalled();
    expect(native.scan).not.toHaveBeenCalled();
  });

  it.each(['', 'https://example.com', 'expired'])('rejects invalid clipboard input: %s', async (value) => {
    native.clipboard.mockResolvedValue(value === 'expired' ? link({ expiresAt: Date.now() - 1 }) : value);
    await expect(readGatewayPairingInput('clipboard')).rejects.toMatchObject({ key: 'invalidPairingLink' });
  });

  it('reports clipboard access failures separately from invalid links', async () => {
    native.clipboard.mockRejectedValue(new Error('Access denied'));
    await expect(readGatewayPairingInput('clipboard')).rejects.toMatchObject({ key: 'clipboardReadFailed' });
  });

  it('decodes the selected local image and skips unrelated QR codes', async () => {
    native.scan.mockResolvedValue([{ data: 'https://example.com' }, { data: link() }]);
    await expect(readGatewayPairingInput('image')).resolves.toMatchObject({ gatewayId: '00000000-0000-4000-8000-000000000000' });
    expect(native.pick).toHaveBeenCalledWith({ mediaTypes: ['images'], allowsMultipleSelection: false, allowsEditing: false, quality: 1 });
    expect(native.scan).toHaveBeenCalledWith('file:///qr.png', ['qr']);
    expect(native.clipboard).not.toHaveBeenCalled();
  });

  it('does nothing when the photo picker is cancelled', async () => {
    native.pick.mockResolvedValue({ canceled: true, assets: null });
    await expect(readGatewayPairingInput('image')).resolves.toBeNull();
    expect(native.scan).not.toHaveBeenCalled();
  });

  it.each(['empty', 'unrelated', 'expired', 'malformed'])('rejects an image with %s QR content', async (kind) => {
    const data = kind === 'unrelated' ? 'https://example.com'
      : kind === 'expired' ? link({ expiresAt: Date.now() - 1 })
        : 'https://link.xopc.ai/c#BA';
    native.scan.mockResolvedValue(kind === 'empty' ? [] : [{ data }]);
    await expect(readGatewayPairingInput('image')).rejects.toMatchObject({ key: 'imageQrNotFound' });
  });

  it('rejects ambiguous images instead of choosing a pairing arbitrarily', async () => {
    native.scan.mockResolvedValue([{ data: link() }, { data: link({
      pairingToken: `xopc_pair_00000000-0000-4000-8000-000000000001_${'c'.repeat(43)}`,
    }) }]);
    await expect(readGatewayPairingInput('image')).rejects.toMatchObject({ key: 'multiplePairingQr' });
  });

  it('accepts duplicate detections of the same pairing code', async () => {
    const data = link();
    native.scan.mockResolvedValue([{ data }, { data }]);
    await expect(readGatewayPairingInput('image')).resolves.toMatchObject({ gatewayId: '00000000-0000-4000-8000-000000000000' });
  });

  it.each(['picker', 'decoder', 'missing-asset'])('reports an image read failure from %s', async (stage) => {
    if (stage === 'picker') native.pick.mockRejectedValue(new Error('Unable to open image library'));
    else if (stage === 'decoder') native.scan.mockRejectedValue(new Error('Unreadable image'));
    else native.pick.mockResolvedValue({ canceled: false, assets: [] });
    await expect(readGatewayPairingInput('image')).rejects.toMatchObject({ key: 'imageReadFailed' });
  });
});
