const XOPC_LOOP_MARK_SVG = `<svg class="logo-mark" viewBox="0 0 1024 1024" fill="none" aria-hidden="true">
  <circle cx="512" cy="512" r="330" stroke="currentColor" stroke-linecap="round" stroke-width="136" stroke-dasharray="1419.162121 654.289030" transform="rotate(11.8 512 512)" />
  <circle cx="512" cy="512" r="330" stroke="var(--logo-accent)" stroke-linecap="round" stroke-width="136" stroke-dasharray="354.790530 1718.660621" transform="rotate(284.2 512 512)" />
</svg>`;

const XOPC_FAVICON_DATA_URI =
  'data:image/svg+xml,' +
  encodeURIComponent(
    '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 1024 1024" fill="none">' +
      '<rect width="944" height="944" x="40" y="40" fill="#f8fafc" rx="216"/>' +
      '<circle cx="512" cy="512" r="300" stroke="#1d1d1f" stroke-dasharray="1290 595" stroke-linecap="round" stroke-width="124" transform="rotate(11.8 512 512)"/>' +
      '<circle cx="512" cy="512" r="300" stroke="#007aff" stroke-dasharray="322 1563" stroke-linecap="round" stroke-width="124" transform="rotate(284.2 512 512)"/>' +
      '</svg>',
  );

const TRAILING_CLOSE_SENTENCE_RE =
  /\s*(?:You may now close this page\.?|You can (?:safely )?close this (?:window|page|tab)\.?|You may close this (?:window|page|tab)\.?)\s*$/i;

export interface OAuthCallbackPageOptions {
  title: string;
  heading?: string;
  message: string;
  tone: 'success' | 'error';
  details?: string;
  returnToAppUrl?: string;
  footerText?: string;
}

function escapeHtml(value: string): string {
  return value.replace(/[&<>"']/g, (character) => ({
    '&': '&amp;',
    '<': '&lt;',
    '>': '&gt;',
    '"': '&quot;',
    "'": '&#39;',
  })[character] ?? character);
}

function normalizeCallbackMessage(message: string): string {
  const trimmed = message.trim();
  const withoutTrailingClose = trimmed.replace(TRAILING_CLOSE_SENTENCE_RE, '').trim();
  return withoutTrailingClose || trimmed;
}

/**
 * Render xopc's branded, self-contained OAuth callback page.
 * Shared across xopc Cloud, model provider OAuth, MCP servers, connectors, and plugins.
 */
export function renderOAuthCallbackPage(options: OAuthCallbackPageOptions): string {
  const safeTitle = escapeHtml(options.title);
  const safeHeading = escapeHtml(options.heading ?? options.title);
  const normalizedMessage = normalizeCallbackMessage(options.message);
  const safeMessage = escapeHtml(normalizedMessage);
  const safeDetails = options.details?.trim() ? escapeHtml(options.details.trim()) : undefined;
  const safeReturnToAppUrl = options.returnToAppUrl?.startsWith('xopc://')
    ? escapeHtml(options.returnToAppUrl)
    : undefined;
  const statusLabel = options.tone === 'success' ? 'Authorization complete' : 'Authorization failed';
  const footerText = escapeHtml(
    options.footerText ?? 'You can safely close this window and return to xopc.',
  );
  const statusIcon = options.tone === 'success'
    ? '<path d="m7.5 12 3 3 6-7" />'
    : '<path d="M12 8v5m0 3.5v.01" />';

  return `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <meta name="referrer" content="no-referrer" />
  <link rel="icon" type="image/svg+xml" href="${XOPC_FAVICON_DATA_URI}" />
  <title>${safeTitle} · xopc</title>
  <style>
    :root {
      color-scheme: light dark;
      --accent: #3a6bff;
      --accent-hover: #315ce6;
      --logo-accent: #007aff;
      --canvas: #f7f8fa;
      --panel: #ffffff;
      --inset: #f1f3f6;
      --text: #111111;
      --muted: #666666;
      --subtle: #8a9099;
      --edge: rgba(17, 17, 17, 0.08);
      --edge-subtle: rgba(17, 17, 17, 0.06);
      --status: ${options.tone === 'success' ? '#17864b' : '#d64242'};
      --status-soft: ${options.tone === 'success' ? '#e7fbf1' : '#fff0f0'};
      --font-sans: -apple-system, BlinkMacSystemFont, "SF Pro Text", "Segoe UI", Roboto, "Helvetica Neue", Arial, "PingFang SC", "Hiragino Sans GB", "Microsoft YaHei", sans-serif;
      --font-mono: ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, "Liberation Mono", "Courier New", monospace;
    }
    * { box-sizing: border-box; }
    html, body { min-height: 100%; }
    body {
      margin: 0;
      min-height: 100vh;
      display: grid;
      place-items: center;
      overflow-x: hidden;
      padding: 24px;
      background:
        radial-gradient(circle at 18% 16%, rgba(58, 107, 255, 0.09), transparent 34rem),
        radial-gradient(circle at 82% 84%, rgba(0, 122, 255, 0.07), transparent 32rem),
        var(--canvas);
      color: var(--text);
      font-family: var(--font-sans);
      -webkit-font-smoothing: antialiased;
    }
    .card {
      position: relative;
      width: min(100%, 468px);
      padding: 32px;
      border: 1px solid var(--edge);
      border-radius: 20px;
      background: var(--panel);
      box-shadow: 0 20px 64px rgba(17, 24, 39, 0.08), 0 2px 10px rgba(17, 24, 39, 0.04);
    }
    .brand {
      display: flex;
      align-items: center;
      gap: 10px;
      margin-bottom: 28px;
      color: var(--text);
    }
    .logo-mark {
      width: 30px;
      height: 30px;
      display: block;
      flex: none;
    }
    .brand-name {
      font-size: 16px;
      font-weight: 650;
      letter-spacing: -0.02em;
    }
    .status {
      display: inline-flex;
      align-items: center;
      gap: 7px;
      margin-bottom: 16px;
      border-radius: 999px;
      padding: 6px 11px 6px 8px;
      background: var(--status-soft);
      color: var(--status);
      font-size: 12px;
      font-weight: 600;
      letter-spacing: 0.01em;
    }
    .status-icon {
      width: 16px;
      height: 16px;
      fill: none;
      stroke: currentColor;
      stroke-width: 2.2;
      stroke-linecap: round;
      stroke-linejoin: round;
      flex: none;
    }
    h1 {
      margin: 0;
      font-size: clamp(22px, 5vw, 26px);
      line-height: 1.2;
      font-weight: 650;
      letter-spacing: -0.025em;
      color: var(--text);
    }
    .message {
      margin: 12px 0 0;
      color: var(--muted);
      font-size: 14.5px;
      line-height: 1.65;
    }
    .details {
      margin-top: 16px;
      padding: 12px 14px;
      border-radius: 12px;
      border: 1px solid var(--edge-subtle);
      background: var(--inset);
      font-family: var(--font-mono);
      font-size: 12.5px;
      line-height: 1.55;
      color: var(--muted);
      white-space: pre-wrap;
      word-break: break-word;
      max-height: 180px;
      overflow-y: auto;
    }
    .return-button {
      display: inline-flex;
      align-items: center;
      justify-content: center;
      margin-top: 22px;
      min-height: 40px;
      border-radius: 10px;
      padding: 0 16px;
      background: var(--accent);
      color: #ffffff;
      font-size: 14px;
      font-weight: 600;
      text-decoration: none;
      transition: background-color 140ms ease;
    }
    .return-button:hover { background: var(--accent-hover); }
    .next-step {
      display: flex;
      align-items: flex-start;
      gap: 10px;
      margin-top: 26px;
      padding-top: 20px;
      border-top: 1px solid var(--edge-subtle);
      color: var(--subtle);
      font-size: 13px;
      line-height: 1.55;
    }
    .window-icon {
      flex: none;
      width: 17px;
      height: 17px;
      margin-top: 2px;
      color: var(--accent);
      fill: none;
      stroke: currentColor;
      stroke-width: 1.8;
      stroke-linecap: round;
      stroke-linejoin: round;
    }
    @media (prefers-color-scheme: dark) {
      :root {
        --accent-hover: #537dff;
        --logo-accent: #0a84ff;
        --canvas: #14171c;
        --panel: #1b1f26;
        --inset: #171b21;
        --text: #f4f6f8;
        --muted: #b8bec8;
        --subtle: #87909d;
        --edge: rgba(255, 255, 255, 0.09);
        --edge-subtle: rgba(255, 255, 255, 0.06);
        --status: ${options.tone === 'success' ? '#63d69a' : '#ff8484'};
        --status-soft: ${options.tone === 'success' ? 'rgba(44, 203, 127, 0.14)' : 'rgba(255, 93, 93, 0.14)'};
      }
      body {
        background:
          radial-gradient(circle at 18% 16%, rgba(58, 107, 255, 0.11), transparent 34rem),
          radial-gradient(circle at 82% 84%, rgba(10, 132, 255, 0.09), transparent 32rem),
          var(--canvas);
      }
      .card { box-shadow: 0 24px 72px rgba(0, 0, 0, 0.42); }
    }
    @media (max-width: 520px) {
      body { padding: 16px; }
      .card { padding: 24px 20px; border-radius: 18px; }
      .brand { margin-bottom: 24px; }
    }
    @media (prefers-reduced-motion: no-preference) {
      .card { animation: enter 320ms cubic-bezier(.2, .75, .25, 1) both; }
      .status-icon { animation: settle 420ms 120ms cubic-bezier(.2, .8, .25, 1.25) both; }
      @keyframes enter { from { opacity: 0; transform: translateY(8px) scale(.99); } }
      @keyframes settle { from { opacity: 0; transform: scale(.7); } }
    }
  </style>
</head>
<body>
  <main class="card">
    <div class="brand">
      ${XOPC_LOOP_MARK_SVG}
      <span class="brand-name">xopc</span>
    </div>
    <div class="status">
      <svg class="status-icon" viewBox="0 0 24 24" aria-hidden="true">${statusIcon}</svg>
      <span id="oauth-status-label">${statusLabel}</span>
    </div>
    <h1 id="oauth-heading">${safeHeading}</h1>
    <p id="oauth-message" class="message">${safeMessage}</p>
    ${safeDetails ? `<div class="details">${safeDetails}</div>` : ''}
    ${safeReturnToAppUrl ? `<a id="return-to-xopc" class="return-button" href="${safeReturnToAppUrl}">Open xopc</a>` : ''}
    <div class="next-step">
      <svg class="window-icon" viewBox="0 0 24 24" aria-hidden="true"><rect x="3" y="5" width="18" height="14" rx="2" /><path d="M3 9h18" /></svg>
      <span id="oauth-footer">${footerText}</span>
    </div>
  </main>
  <script>
    (function () {
      var lang = (navigator.language || '').toLowerCase();
      if (lang.indexOf('zh') === 0) {
        var exact = {
          'Authorization complete': '授权已完成',
          'Authorization failed': '授权未完成',
          'Authentication successful': '授权成功',
          'Authentication failed': '授权失败',
          'Authorization callback not found': '回调地址无效',
          'Signed in to the MCP server.': '已完成 MCP 服务连接授权。',
          'ChatGPT authentication completed.': '已完成 ChatGPT 账号登录授权。',
          'Google authentication completed.': '已完成 Google 账号登录授权。',
          'Google authentication did not complete.': 'Google 账号登录未完成。',
          'ChatGPT was not connected.': '未能连接 ChatGPT 账号。',
          'XOPC received the authorization callback successfully.': 'xopc 已成功接收授权回调。',
          'This is not a valid XOPC OAuth callback URL.': '这不是有效的 xopc OAuth 回调地址。',
          'Callback route not found.': '未找到对应的回调路径。',
          'State mismatch.': '安全校验状态不匹配，请重新发起授权。',
          'Invalid or expired OAuth state': '授权状态无效或已过期，请重新发起授权。',
          'This sign-in has already been handled.': '本次登录授权已经处理完成。',
          'Missing authorization code.': '缺少授权码，请重新尝试。',
          'Missing code or state parameter.': '缺少授权码或状态参数，请重新尝试。',
          'Authorization failed.': '授权未完成，请返回 xopc 重试。',
          'Internal error while processing the callback.': '处理授权回调时出现内部错误。',
          'Open xopc': '打开 xopc',
          'You can safely close this window and return to xopc.': '你可以安全关闭此窗口并返回 xopc。'
        };
        function translate(text) {
          if (exact[text]) return exact[text];
          var signedIn = /^Signed in to (.+?)\.?$/.exec(text);
          if (signedIn) return '已完成 ' + signedIn[1] + ' 登录授权。';
          var failed = /^(.+?) (?:authorization|sign-in) failed\.?$/.exec(text);
          if (failed) return failed[1] + ' 登录授权失败。';
          return null;
        }
        ['oauth-status-label', 'oauth-heading', 'oauth-message', 'oauth-footer', 'return-to-xopc'].forEach(function (id) {
          var el = document.getElementById(id);
          if (!el || !el.textContent) return;
          var next = translate(el.textContent.trim());
          if (next) el.textContent = next;
        });
        var heading = document.getElementById('oauth-heading');
        if (heading && heading.textContent) document.title = heading.textContent + ' · xopc';
      }
      var returnLink = document.getElementById('return-to-xopc');
      if (returnLink) {
        window.setTimeout(function () {
          window.location.href = returnLink.href;
        }, 350);
      }
    })();
  </script>
</body>
</html>`;
}

export function oauthSuccessHtml(
  message: string,
  options?: { title?: string; heading?: string; returnToAppUrl?: string },
): string {
  return renderOAuthCallbackPage({
    title: options?.title ?? 'Authentication successful',
    heading: options?.heading ?? options?.title ?? 'Authentication successful',
    message,
    tone: 'success',
    returnToAppUrl: options?.returnToAppUrl,
  });
}

export function oauthErrorHtml(
  message: string,
  details?: string,
  options?: { title?: string; heading?: string },
): string {
  return renderOAuthCallbackPage({
    title: options?.title ?? 'Authentication failed',
    heading: options?.heading ?? options?.title ?? 'Authentication failed',
    message,
    details,
    tone: 'error',
  });
}
