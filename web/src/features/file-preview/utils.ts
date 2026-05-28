export function getFileExtension(path: string): string {
  const i = path.lastIndexOf('.');
  if (i <= 0 || i === path.length - 1) return '';
  return path.slice(i).toLowerCase();
}

export function getFileName(path: string): string {
  const parts = path.split('/');
  return parts[parts.length - 1] || path;
}

/** No in-browser preview — offer download / open externally only. */
const PREVIEW_BINARY_ONLY_EXTS = new Set([
  '.doc',
  '.ppt',
  '.pps',
  '.zip',
  '.rar',
  '.7z',
  '.exe',
  '.dll',
  '.dmg',
  '.pkg',
  '.msi',
  '.bin',
  '.mp4',
  '.mp3',
  '.mov',
  '.wav',
]);

/** Raster / binary image: must use base64, not UTF-8 text. */
const RASTER_IMAGE_EXTS = new Set([
  '.png',
  '.jpg',
  '.jpeg',
  '.gif',
  '.webp',
  '.bmp',
  '.ico',
  '.tif',
  '.tiff',
  '.avif',
  '.heic',
  '.heif',
  '.jxl',
]);

function isRasterImageExt(ext: string): boolean {
  return RASTER_IMAGE_EXTS.has(ext.toLowerCase());
}

/** In-panel preview: show as <img> (incl. SVG and HEIC; HEIC may not decode in all browsers). */
export function isImagePreviewExt(ext: string): boolean {
  const l = ext.toLowerCase();
  if (l === '.svg' || l === '.svgz') {
    return true;
  }
  return isRasterImageExt(l);
}

export function isBinaryOnlyPreviewExt(ext: string): boolean {
  return PREVIEW_BINARY_ONLY_EXTS.has(ext.toLowerCase());
}

/**
 * `readWorkspaceFile` (UTF-8) corrupts binary; use base64 for download and image preview load.
 * SVG (UTF-8 XML) is listed under {@link isImagePreviewExt} for <img> preview but is **not** included
 * here so the project-files menu can still download via a single text read.
 */
export function shouldReadWorkspaceFileAsBase64Path(path: string): boolean {
  const ext = getFileExtension(path);
  if (isRasterImageExt(ext)) {
    return true;
  }
  if (ext === '.pdf' || ext === '.xlsx' || ext === '.xls' || ext === '.docx' || ext === '.pptx') {
    return true;
  }
  if (isBinaryOnlyPreviewExt(ext)) {
    return true;
  }
  return false;
}

