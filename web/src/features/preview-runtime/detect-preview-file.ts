import type { PreviewFileType, PreviewReadMode } from '@/features/preview-runtime/preview-types';

export const TEXT_PREVIEW_MAX_BYTES = 5 * 1024 * 1024;
export const BINARY_PREVIEW_MAX_BYTES = 32 * 1024 * 1024;

const CODE_EXTS = new Set([
  '.astro',
  '.bat',
  '.c',
  '.cc',
  '.clj',
  '.cljs',
  '.cljc',
  '.cmd',
  '.cpp',
  '.cs',
  '.cts',
  '.cxx',
  '.dart',
  '.edn',
  '.erl',
  '.ex',
  '.exs',
  '.fish',
  '.fs',
  '.fsx',
  '.go',
  '.gql',
  '.graphql',
  '.groovy',
  '.h',
  '.hh',
  '.hpp',
  '.hrl',
  '.hxx',
  '.java',
  '.ts',
  '.tsx',
  '.mts',
  '.js',
  '.jsx',
  '.mjs',
  '.cjs',
  '.css',
  '.scss',
  '.sass',
  '.less',
  '.json',
  '.jsonc',
  '.json5',
  '.yml',
  '.yaml',
  '.xml',
  '.xsd',
  '.xsl',
  '.py',
  '.pyw',
  '.rb',
  '.php',
  '.rs',
  '.kt',
  '.kts',
  '.scala',
  '.swift',
  '.m',
  '.mm',
  '.sh',
  '.bash',
  '.zsh',
  '.ps1',
  '.sql',
  '.lua',
  '.r',
  '.pl',
  '.pm',
  '.sol',
  '.tf',
  '.tfvars',
  '.nix',
  '.proto',
  '.vue',
  '.svelte',
  '.toml',
  '.ini',
  '.cfg',
  '.conf',
  '.properties',
]);

const TEXT_EXTS = new Set([
  '.txt', '.log', '.lock', '.csv', '.tsv', '.env', '.gitignore', '.gitattributes',
  '.editorconfig', '.npmrc', '.dockerignore', '.eslintignore', '.prettierignore', '.stylelintignore',
]);
const CODE_FILE_NAMES = new Set(['dockerfile', 'gemfile', 'jenkinsfile', 'makefile', 'procfile', 'rakefile']);
const TEXT_FILE_NAMES = new Set(['brewfile', 'changelog', 'codeowners', 'license', 'readme']);
const IMAGE_EXTS = new Set([
  '.png',
  '.jpg',
  '.jpeg',
  '.gif',
  '.webp',
  '.bmp',
  '.ico',
  '.svg',
  '.svgz',
  '.tif',
  '.tiff',
  '.avif',
  '.heic',
  '.heif',
  '.jxl',
]);
const AUDIO_EXTS = new Set(['.mp3', '.wav', '.ogg', '.oga', '.aac', '.m4a', '.flac', '.opus', '.weba']);
const VIDEO_EXTS = new Set(['.mp4', '.webm', '.mov', '.m4v', '.ogv']);
const ARCHIVE_EXTS = new Set(['.zip']);

const MIME_BY_EXT = new Map<string, string>([
  ['.pdf', 'application/pdf'],
  ['.docx', 'application/vnd.openxmlformats-officedocument.wordprocessingml.document'],
  ['.pptx', 'application/vnd.openxmlformats-officedocument.presentationml.presentation'],
  ['.xlsx', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'],
  ['.xls', 'application/vnd.ms-excel'],
  ['.md', 'text/markdown'],
  ['.markdown', 'text/markdown'],
  ['.html', 'text/html'],
  ['.htm', 'text/html'],
  ['.json', 'application/json'],
  ['.txt', 'text/plain'],
  ['.csv', 'text/csv'],
  ['.tsv', 'text/tab-separated-values'],
  ['.png', 'image/png'],
  ['.jpg', 'image/jpeg'],
  ['.jpeg', 'image/jpeg'],
  ['.gif', 'image/gif'],
  ['.webp', 'image/webp'],
  ['.svg', 'image/svg+xml'],
  ['.svgz', 'image/svg+xml'],
  ['.mp3', 'audio/mpeg'],
  ['.wav', 'audio/wav'],
  ['.ogg', 'audio/ogg'],
  ['.mp4', 'video/mp4'],
  ['.webm', 'video/webm'],
  ['.mov', 'video/quicktime'],
  ['.zip', 'application/zip'],
]);

export function getPreviewFileExtension(path: string): string {
  const fileName = getPreviewFileName(path);
  const i = fileName.lastIndexOf('.');
  if (i < 0 || i === fileName.length - 1) return '';
  return fileName.slice(i).toLowerCase();
}

export function getPreviewFileName(path: string): string {
  const normalized = path.replace(/\\/g, '/');
  const parts = normalized.split('/');
  return parts[parts.length - 1] || path;
}

export function inferPreviewMimeType(fileName: string, mimeType?: string | null): string {
  const normalized = mimeType?.split(';')[0]?.trim().toLowerCase();
  if (normalized && normalized !== 'application/octet-stream') return normalized;
  return MIME_BY_EXT.get(getPreviewFileExtension(fileName)) ?? normalized ?? 'application/octet-stream';
}

export function detectPreviewFileType(fileName: string, mimeType?: string | null): PreviewFileType {
  const ext = getPreviewFileExtension(fileName);
  const normalizedName = getPreviewFileName(fileName).toLowerCase();
  const mime = inferPreviewMimeType(fileName, mimeType);

  if (mime === 'text/markdown' || ext === '.md' || ext === '.markdown') return 'markdown';
  if (mime === 'text/html' || ext === '.html' || ext === '.htm') return 'html';
  if (mime === 'application/pdf' || ext === '.pdf') return 'pdf';
  if (mime === 'application/vnd.openxmlformats-officedocument.wordprocessingml.document' || ext === '.docx') {
    return 'docx';
  }
  if (
    mime === 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' ||
    mime === 'application/vnd.ms-excel' ||
    ext === '.xlsx' ||
    ext === '.xls'
  ) {
    return 'spreadsheet';
  }
  if (mime === 'application/vnd.openxmlformats-officedocument.presentationml.presentation' || ext === '.pptx') {
    return 'pptx';
  }
  if (mime.startsWith('image/') || IMAGE_EXTS.has(ext)) return 'image';
  if (mime.startsWith('audio/') || AUDIO_EXTS.has(ext)) return 'audio';
  if (mime.startsWith('video/') || VIDEO_EXTS.has(ext)) return 'video';
  if (mime === 'application/zip' || ARCHIVE_EXTS.has(ext)) return 'archive';
  if (CODE_EXTS.has(ext) || CODE_FILE_NAMES.has(normalizedName) || normalizedName.startsWith('dockerfile.')) return 'code';
  if (
    mime.startsWith('text/')
    || TEXT_EXTS.has(ext)
    || TEXT_FILE_NAMES.has(normalizedName)
    || normalizedName.startsWith('.env.')
    || mime === 'application/json'
  ) return 'text';
  return 'unsupported';
}

export function readModeForPreviewType(type: PreviewFileType): PreviewReadMode {
  switch (type) {
    case 'text':
    case 'markdown':
    case 'code':
    case 'html':
      return 'text';
    case 'unsupported':
      return 'metadata';
    default:
      return 'binary';
  }
}

export function maxBytesForPreviewType(type: PreviewFileType): number | undefined {
  if (type === 'text' || type === 'markdown' || type === 'code' || type === 'html') return TEXT_PREVIEW_MAX_BYTES;
  if (type === 'unsupported') return undefined;
  return BINARY_PREVIEW_MAX_BYTES;
}
