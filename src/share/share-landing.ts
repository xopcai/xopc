import type { DirectoryListing, DirectoryListingEntry } from './share-store.js';
import type { NoteShareRecord, SessionShareRecord, ShareRecord } from './share-types.js';

function formatFileSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1_048_576) return `${(bytes / 1024).toFixed(1)} KB`;
  if (bytes < 1_073_741_824) return `${(bytes / 1_048_576).toFixed(1)} MB`;
  return `${(bytes / 1_073_741_824).toFixed(1)} GB`;
}

function escapeHtml(text: string): string {
  return text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function commonCss(): string {
  return `
*{margin:0;padding:0;box-sizing:border-box}
body{font-family:-apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,sans-serif;background:#f8fafc;color:#1e293b;min-height:100vh;display:flex;align-items:flex-start;justify-content:center;padding:1rem}
.card{background:#fff;border:1px solid #e2e8f0;border-radius:12px;padding:2rem;max-width:720px;width:100%;box-shadow:0 1px 3px rgba(0,0,0,.06);margin:1rem 0}
.icon{font-size:2.5rem;margin-bottom:1rem;text-align:center}
.name{font-size:1.125rem;font-weight:600;word-break:break-all;text-align:center;margin-bottom:.5rem}
.meta{font-size:.875rem;color:#64748b;text-align:center;margin-bottom:.25rem}
.desc{font-size:.875rem;color:#475569;margin:1rem 0;padding:.75rem;background:#f1f5f9;border-radius:8px}
.btn{display:inline-block;padding:.6rem 1.4rem;background:#2563eb;color:#fff;text-decoration:none;border-radius:8px;font-weight:500;font-size:.95rem;border:none;cursor:pointer;transition:background .15s;margin:.25rem}
.btn.secondary{background:#475569}
.btn:hover{filter:brightness(1.1)}
.footer{margin-top:1.5rem;font-size:.75rem;color:#94a3b8;text-align:center}
.actions{text-align:center;margin-top:1.5rem}
.crumb{font-size:.85rem;color:#475569;margin-bottom:1rem}
.crumb a{color:#2563eb;text-decoration:none}
.crumb a:hover{text-decoration:underline}
.tree{border-top:1px solid #e2e8f0;margin-top:1rem}
.row{display:flex;align-items:center;justify-content:space-between;padding:.55rem .25rem;border-bottom:1px solid #f1f5f9}
.row a{text-decoration:none;color:#1e293b;flex:1;min-width:0;display:flex;align-items:center;gap:.5rem}
.row a:hover{color:#2563eb}
.row .size{color:#94a3b8;font-size:.8rem;margin-left:.75rem;white-space:nowrap}
.row .act{display:flex;gap:.5rem;align-items:center}
.row .act a{font-size:.8rem;color:#2563eb;flex:none}
.empty{text-align:center;color:#94a3b8;padding:2rem}
`;
}

export interface ShareLandingOgOptions {
  /** Absolute https/http URL of this landing page (for og:url). Omit if non-public. */
  absoluteShareUrl?: string | null;
  /** Absolute URL of the thumbnail image (for og:image). Omit if non-public. */
  absoluteThumbnailUrl?: string | null;
  /** Title override (default: fileName). */
  title?: string;
  /** Description override (default: type + size). */
  description?: string;
}

/** Lightweight public shell for state-owned snapshots. Crawlers get metadata; browsers continue to the SPA preview. */
export function renderSnapshotShareLandingPage(
  record: NoteShareRecord | SessionShareRecord,
  previewUrl: string,
  options: { label: 'Note' | 'conversation'; og?: ShareLandingOgOptions },
): string {
  const title = escapeHtml(record.fileName);
  const description = escapeHtml(record.description ?? `A ${options.label} shared via xopc`);
  const target = escapeHtml(previewUrl);
  const ogTags = renderOgTags({
    title,
    description,
    url: options?.og?.absoluteShareUrl ?? null,
    image: options?.og?.absoluteThumbnailUrl ?? null,
  });
  return `<!DOCTYPE html>
<html lang="zh">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<meta name="referrer" content="no-referrer">
<meta name="robots" content="noindex,nofollow">
${ogTags}
<title>${title} — xopc Share</title>
<meta http-equiv="refresh" content="0;url=${target}">
</head>
<body>
<p><a href="${target}">Open shared ${options.label}</a></p>
<script>location.replace(${JSON.stringify(previewUrl)})</script>
</body>
</html>`;
}

/** Render the file download confirmation landing page (does not consume downloadCount). */
export function renderShareLandingPage(
  record: ShareRecord,
  downloadPath: string,
  options?: {
    /** Path to open the file inline (?inline=1) for browser-native rendering. */
    inlineUrl?: string | null;
    /** SPA preview URL (for markdown / docs / code that benefit from rich rendering). */
    previewUrl?: string | null;
    /** Social card / unfurl metadata. */
    og?: ShareLandingOgOptions;
  },
): string {
  const fileName = escapeHtml(record.fileName);
  const description = record.description ? escapeHtml(record.description) : '';
  const size = formatFileSize(record.fileSize);
  const expiresDate = new Date(record.expiresAt).toLocaleDateString('zh-CN', {
    year: 'numeric',
    month: 'long',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });

  const buttons: string[] = [];
  if (options?.previewUrl) {
    buttons.push(
      `<a class="btn" href="${escapeHtml(options.previewUrl)}" target="_blank" rel="noopener">👁 在线预览</a>`,
    );
  }
  if (options?.inlineUrl) {
    buttons.push(
      `<a class="btn secondary" href="${escapeHtml(options.inlineUrl)}" target="_blank" rel="noopener">↗ 在线打开</a>`,
    );
  }
  buttons.push(
    `<form method="POST" action="${escapeHtml(downloadPath)}" style="display:inline">
<button type="submit" class="btn ${buttons.length > 0 ? 'secondary' : ''}">⬇ 下载文件</button>
</form>`,
  );

  const ogTitle = escapeHtml(options?.og?.title ?? record.fileName);
  const ogDesc = escapeHtml(options?.og?.description ?? `${size} · 由 xopc 分享`);
  const ogTags = renderOgTags({
    title: ogTitle,
    description: ogDesc,
    url: options?.og?.absoluteShareUrl ?? null,
    image: options?.og?.absoluteThumbnailUrl ?? null,
  });

  return `<!DOCTYPE html>
<html lang="zh">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<meta name="referrer" content="no-referrer">
<meta name="robots" content="noindex,follow">
${ogTags}
<title>${fileName} — xopc Share</title>
<style>${commonCss()}</style>
</head>
<body>
<div class="card">
<div class="icon">📄</div>
<div class="name">${fileName}</div>
<div class="meta">${size} · 有效期至 ${expiresDate}</div>
${description ? `<div class="desc">${description}</div>` : ''}
<div class="actions">
${buttons.join('\n')}
</div>
<div class="footer">Shared via xopc</div>
</div>
</body>
</html>`;
}

/** Emit OG / Twitter / WeChat-compatible meta tags. Only emitted when url+image present. */
function renderOgTags(opts: { title: string; description: string; url: string | null; image: string | null }): string {
  if (!opts.url || !opts.image) return '';
  return [
    `<meta property="og:type" content="website">`,
    `<meta property="og:site_name" content="xopc Share">`,
    `<meta property="og:title" content="${opts.title}">`,
    `<meta property="og:description" content="${opts.description}">`,
    `<meta property="og:image" content="${escapeHtml(opts.image)}">`,
    `<meta property="og:image:width" content="1200">`,
    `<meta property="og:image:height" content="630">`,
    `<meta property="og:url" content="${escapeHtml(opts.url)}">`,
    `<meta itemprop="name" content="${opts.title}">`,
    `<meta itemprop="description" content="${opts.description}">`,
    `<meta itemprop="image" content="${escapeHtml(opts.image)}">`,
    `<meta name="twitter:card" content="summary_large_image">`,
  ].join('\n');
}

/** Render the folder landing page (browse mode shows a tree, zip-only shows a single button). */
export function renderFolderLandingPage(
  record: ShareRecord,
  listing: DirectoryListing | null,
  urls: { tree: (path: string) => string; file: (path: string) => string; zip: (path: string) => string },
  options?: { og?: ShareLandingOgOptions },
): string {
  const folderName = escapeHtml(record.fileName);
  const description = record.description ? escapeHtml(record.description) : '';
  const totalSize = formatFileSize(record.fileSize);
  const entryCount = record.directory?.entryCount ?? 0;
  const expiresDate = new Date(record.expiresAt).toLocaleDateString('zh-CN', {
    year: 'numeric',
    month: 'long',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });
  const zipOnly = record.directory?.mode === 'zip-only' || !listing;
  const zipUrl = urls.zip('');

  const treeHtml = zipOnly ? '' : renderTree(listing!, urls);
  const breadcrumbs = zipOnly ? '' : renderBreadcrumbs(listing!.path, urls);

  const ogTitle = escapeHtml(options?.og?.title ?? record.fileName);
  const ogDesc = escapeHtml(options?.og?.description ?? `${entryCount} 项 · ${totalSize}`);
  const ogTags = renderOgTags({
    title: ogTitle,
    description: ogDesc,
    url: options?.og?.absoluteShareUrl ?? null,
    image: options?.og?.absoluteThumbnailUrl ?? null,
  });

  return `<!DOCTYPE html>
<html lang="zh">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<meta name="referrer" content="no-referrer">
<meta name="robots" content="noindex,follow">
${ogTags}
<title>${folderName} — xopc Share</title>
<style>${commonCss()}</style>
</head>
<body>
<div class="card">
<div class="icon">📁</div>
<div class="name">${folderName}</div>
<div class="meta">${entryCount} 项 · ${totalSize} · 有效期至 ${expiresDate}</div>
${description ? `<div class="desc">${description}</div>` : ''}
<div class="actions">
<a class="btn" href="${escapeHtml(zipUrl)}">⬇ 下载全部为 ZIP</a>
</div>
${breadcrumbs}
${treeHtml}
<div class="footer">Shared via xopc</div>
</div>
</body>
</html>`;
}

function renderBreadcrumbs(
  currentPath: string,
  urls: { tree: (path: string) => string },
): string {
  if (!currentPath) return '<div class="crumb"><a href="' + escapeHtml(urls.tree('')) + '">/ 根目录</a></div>';
  const segments = currentPath.split('/').filter(Boolean);
  const links: string[] = [`<a href="${escapeHtml(urls.tree(''))}">/ 根目录</a>`];
  let cumulative = '';
  for (const seg of segments) {
    cumulative = cumulative ? `${cumulative}/${seg}` : seg;
    links.push(`<a href="${escapeHtml(urls.tree(cumulative))}">${escapeHtml(seg)}</a>`);
  }
  return `<div class="crumb">${links.join(' / ')}</div>`;
}

function renderTree(
  listing: DirectoryListing,
  urls: { tree: (path: string) => string; file: (path: string) => string; zip: (path: string) => string },
): string {
  if (listing.entries.length === 0) {
    return '<div class="tree"><div class="empty">空目录</div></div>';
  }
  const rows = listing.entries.map((entry) => renderTreeRow(entry, urls)).join('');
  const truncated = listing.truncated
    ? '<div class="empty">列表过长已截断（仍可通过 URL 访问子目录）</div>'
    : '';
  return `<div class="tree">${rows}${truncated}</div>`;
}

function renderTreeRow(
  entry: DirectoryListingEntry,
  urls: { tree: (path: string) => string; file: (path: string) => string; zip: (path: string) => string },
): string {
  const safeName = escapeHtml(entry.name);
  if (entry.isDirectory) {
    return `<div class="row">
<a href="${escapeHtml(urls.tree(entry.path))}"><span>📁</span><span>${safeName}/</span></a>
<div class="act">
<a href="${escapeHtml(urls.zip(entry.path))}">ZIP</a>
</div>
</div>`;
  }
  return `<div class="row">
<a href="${escapeHtml(urls.file(entry.path))}"><span>📄</span><span>${safeName}</span></a>
<div class="act">
<span class="size">${formatFileSize(entry.size)}</span>
<a href="${escapeHtml(urls.file(entry.path))}?dl=1">下载</a>
</div>
</div>`;
}

export type ShareExpiredReason = 'expired' | 'revoked' | 'max_views' | 'not_found' | 'file_deleted';

/** Render the "share no longer valid" page — does NOT reveal file name or path. */
export function renderShareExpiredPage(reason: ShareExpiredReason): string {
  const reasons: Record<ShareExpiredReason, string> = {
    expired: '链接已过期',
    revoked: '链接已被创建者撤销',
    max_views: '已达最大访问次数',
    not_found: '链接无效或已失效',
    file_deleted: '分享的文件已不存在',
  };
  const reasonText = reasons[reason] ?? reasons.not_found;

  return `<!DOCTYPE html>
<html lang="zh">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<meta name="referrer" content="no-referrer">
<meta name="robots" content="noindex,nofollow">
<title>分享已失效 — xopc</title>
<style>${commonCss()}</style>
</head>
<body>
<div class="card" style="max-width:420px;text-align:center">
<div class="icon">⚠️</div>
<h1 style="font-size:1.125rem;font-weight:600;margin-bottom:1rem">此分享链接已失效</h1>
<div class="meta">${reasonText}</div>
<div class="footer">如需访问请联系分享者获取新链接</div>
</div>
</body>
</html>`;
}
