/**
 * Minimal startup screen shown while the embedded gateway process becomes healthy.
 * Loaded as a data: URL so no extra asset packaging is required.
 *
 * Copy mirrors web default-locale rule: `en` / `en-*` → English UI; otherwise Chinese.
 */

function uiLangFromAppLocale(locale: string): 'en' | 'zh' {
  const t = locale.trim().toLowerCase().replace(/_/g, '-');
  if (!t || t === 'en' || t.startsWith('en-')) return 'en';
  return 'zh';
}

export function getLoadingPageDataUrl(appLocale: string): string {
  const lang = uiLangFromAppLocale(appLocale || 'en');
  const isEn = lang === 'en';
  const htmlLang = isEn ? 'en' : 'zh-CN';
  const title = isEn ? 'Starting local gateway…' : '正在启动本地网关…';
  const hint = isEn ? 'This may take a few seconds on first launch.' : '首次启动可能需要几秒钟。';
  const failTitle = isEn ? 'Could not start' : '无法启动';
  const failSub = isEn ? 'The app will close. You can restart after fixing the issue.' : '应用将退出。处理问题后可重新打开。';
  const unknownErr = isEn ? 'Unknown error' : '未知错误';

  const html = `<!DOCTYPE html>
<html lang="${htmlLang}">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <title>xopc</title>
  <style>
    * { box-sizing: border-box; }
    body {
      margin: 0;
      min-height: 100vh;
      display: flex;
      flex-direction: column;
      align-items: center;
      justify-content: center;
      padding: 2rem;
      font-family: ui-sans-serif, system-ui, -apple-system, "Segoe UI", Roboto, "PingFang SC", "Microsoft YaHei", sans-serif;
      background: #0f172a;
      color: #e2e8f0;
    }
    .card {
      max-width: 28rem;
      text-align: center;
    }
    h1 {
      margin: 0 0 0.5rem;
      font-size: 1.125rem;
      font-weight: 600;
      letter-spacing: -0.02em;
    }
    p {
      margin: 0;
      font-size: 0.875rem;
      line-height: 1.5;
      color: #94a3b8;
    }
    #status {
      margin-top: 1rem;
      font-size: 0.8125rem;
      color: #f87171;
      white-space: pre-wrap;
      word-break: break-word;
    }
    #sub {
      margin-top: 0.75rem;
      font-size: 0.8125rem;
      color: #94a3b8;
    }
    .spinner {
      width: 2.25rem;
      height: 2.25rem;
      margin: 0 auto 1.25rem;
      border: 2px solid #334155;
      border-top-color: #38bdf8;
      border-radius: 50%;
      animation: spin 0.85s linear infinite;
    }
    @keyframes spin {
      to { transform: rotate(360deg); }
    }
  </style>
</head>
<body>
  <div class="card">
    <div class="spinner" aria-hidden="true"></div>
    <h1 id="title">${title}</h1>
    <p id="hint">${hint}</p>
    <p id="status" style="display:none"></p>
    <p id="sub" style="display:none"></p>
  </div>
  <script>
    (function () {
      var failTitle = ${JSON.stringify(failTitle)};
      var failSub = ${JSON.stringify(failSub)};
      var unknownErr = ${JSON.stringify(unknownErr)};
      if (!window.electronAPI || !window.electronAPI.startup || typeof window.electronAPI.startup.onFailed !== 'function') return;
      window.electronAPI.startup.onFailed(function (d) {
        var st = document.getElementById('status');
        var sub = document.getElementById('sub');
        var titleEl = document.getElementById('title');
        var hint = document.getElementById('hint');
        if (titleEl) titleEl.textContent = failTitle;
        if (hint) hint.style.display = 'none';
        if (st) {
          st.style.display = 'block';
          st.textContent = d && d.message ? d.message : unknownErr;
        }
        if (sub) {
          sub.style.display = 'block';
          sub.textContent = failSub;
        }
      });
    })();
  </script>
</body>
</html>`;
  return `data:text/html;charset=utf-8,${encodeURIComponent(html)}`;
}
