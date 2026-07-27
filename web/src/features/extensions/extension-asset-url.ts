import { apiUrl } from '@/lib/url';

function encodeAssetPath(entrypoint: string): string {
  return entrypoint
    .split('/')
    .filter(Boolean)
    .map((segment) => encodeURIComponent(segment))
    .join('/');
}

export function buildExtensionAssetUrl(extensionId: string, entrypoint: string): string {
  const relativePath = encodeAssetPath(entrypoint);
  return apiUrl(
    `/api/extensions/${encodeURIComponent(extensionId)}/assets/${relativePath}`,
  );
}
