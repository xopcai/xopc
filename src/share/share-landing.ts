import type { ShareRecord } from './share-types.js';

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

/** Render the download confirmation landing page (does not consume viewCount). */
export function renderShareLandingPage(record: ShareRecord, downloadPath: string): string {
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

  return `<!DOCTYPE html>
<html lang="zh">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<meta name="referrer" content="no-referrer">
<meta name="robots" content="noindex,nofollow">
<title>${fileName} — xopc Share</title>
<style>
*{margin:0;padding:0;box-sizing:border-box}
body{font-family:-apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,sans-serif;background:#f8fafc;color:#1e293b;min-height:100vh;display:flex;align-items:center;justify-content:center;padding:1rem}
.card{background:#fff;border:1px solid #e2e8f0;border-radius:12px;padding:2rem;max-width:420px;width:100%;text-align:center;box-shadow:0 1px 3px rgba(0,0,0,.06)}
.icon{font-size:2.5rem;margin-bottom:1rem}
.name{font-size:1.125rem;font-weight:600;word-break:break-all;margin-bottom:.5rem}
.meta{font-size:.875rem;color:#64748b;margin-bottom:.25rem}
.desc{font-size:.875rem;color:#475569;margin:1rem 0;padding:.75rem;background:#f1f5f9;border-radius:8px;text-align:left}
.btn{display:inline-block;margin-top:1.5rem;padding:.75rem 2rem;background:#2563eb;color:#fff;text-decoration:none;border-radius:8px;font-weight:500;font-size:1rem;border:none;cursor:pointer;transition:background .15s}
.btn:hover{background:#1d4ed8}
.footer{margin-top:1.5rem;font-size:.75rem;color:#94a3b8}
</style>
</head>
<body>
<div class="card">
<div class="icon">📄</div>
<div class="name">${fileName}</div>
<div class="meta">${size} · 有效期至 ${expiresDate}</div>
${description ? `<div class="desc">${description}</div>` : ''}
<form method="POST" action="${escapeHtml(downloadPath)}">
<button type="submit" class="btn">⬇ 下载文件</button>
</form>
<div class="footer">Shared via xopc</div>
</div>
</body>
</html>`;
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
<style>
*{margin:0;padding:0;box-sizing:border-box}
body{font-family:-apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,sans-serif;background:#f8fafc;color:#1e293b;min-height:100vh;display:flex;align-items:center;justify-content:center;padding:1rem}
.card{background:#fff;border:1px solid #e2e8f0;border-radius:12px;padding:2rem;max-width:420px;width:100%;text-align:center;box-shadow:0 1px 3px rgba(0,0,0,.06)}
.icon{font-size:2.5rem;margin-bottom:1rem}
h1{font-size:1.125rem;font-weight:600;margin-bottom:1rem}
.reason{font-size:.875rem;color:#64748b;margin-bottom:1rem}
.hint{font-size:.8125rem;color:#94a3b8;margin-top:1rem}
</style>
</head>
<body>
<div class="card">
<div class="icon">⚠️</div>
<h1>此分享链接已失效</h1>
<div class="reason">${reasonText}</div>
<div class="hint">如需访问请联系分享者获取新链接</div>
</div>
</body>
</html>`;
}
