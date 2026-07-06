import { Camera } from 'expo-camera';

/** Read native camera permission; avoids stale `useCameraPermissions` hook state after first grant. */
export async function ensureGatewayQrCameraPermission(): Promise<boolean> {
  let status = await Camera.getCameraPermissionsAsync();
  if (!status.granted) {
    status = await Camera.requestCameraPermissionsAsync();
  }
  return status.granted;
}
