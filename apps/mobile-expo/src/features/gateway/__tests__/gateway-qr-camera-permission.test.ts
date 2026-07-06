import { beforeEach, describe, expect, it, vi } from 'vitest';

const getCameraPermissionsAsync = vi.fn();
const requestCameraPermissionsAsync = vi.fn();

vi.mock('expo-camera', () => ({
  Camera: {
    getCameraPermissionsAsync,
    requestCameraPermissionsAsync,
  },
}));

describe('ensureGatewayQrCameraPermission', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('returns true when permission is already granted', async () => {
    getCameraPermissionsAsync.mockResolvedValue({ granted: true, canAskAgain: true, status: 'granted' });

    const { ensureGatewayQrCameraPermission } = await import('../gateway-qr-camera-permission');
    await expect(ensureGatewayQrCameraPermission()).resolves.toBe(true);
    expect(requestCameraPermissionsAsync).not.toHaveBeenCalled();
  });

  it('requests permission when not yet granted', async () => {
    getCameraPermissionsAsync.mockResolvedValue({ granted: false, canAskAgain: true, status: 'undetermined' });
    requestCameraPermissionsAsync.mockResolvedValue({ granted: true, canAskAgain: true, status: 'granted' });

    const { ensureGatewayQrCameraPermission } = await import('../gateway-qr-camera-permission');
    await expect(ensureGatewayQrCameraPermission()).resolves.toBe(true);
    expect(requestCameraPermissionsAsync).toHaveBeenCalledOnce();
  });

  it('returns false when permission is denied', async () => {
    getCameraPermissionsAsync.mockResolvedValue({ granted: false, canAskAgain: false, status: 'denied' });
    requestCameraPermissionsAsync.mockResolvedValue({ granted: false, canAskAgain: false, status: 'denied' });

    const { ensureGatewayQrCameraPermission } = await import('../gateway-qr-camera-permission');
    await expect(ensureGatewayQrCameraPermission()).resolves.toBe(false);
  });
});
