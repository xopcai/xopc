/**
 * Minimal startup screen shown while the embedded gateway process becomes healthy.
 * Loaded as a data: URL so no extra asset packaging is required.
 *
 * Copy mirrors web default-locale rule: `en` / `en-*` → English UI; otherwise Chinese.
 */

import type { GatewayStartupFailure } from './startup-failure.js';

function uiLangFromAppLocale(locale: string): 'en' | 'zh' {
  const t = locale.trim().toLowerCase().replace(/_/g, '-');
  if (!t || t === 'en' || t.startsWith('en-')) return 'en';
  return 'zh';
}

function escapeHtml(value: unknown): string {
  return String(value ?? '').replace(/[&<>"']/g, (ch) => {
    switch (ch) {
      case '&':
        return '&amp;';
      case '<':
        return '&lt;';
      case '>':
        return '&gt;';
      case '"':
        return '&quot;';
      case "'":
        return '&#39;';
      default:
        return ch;
    }
  });
}

function valueOrDash(value: unknown): string {
  if (value === undefined || value === null || value === '') return '-';
  return String(value);
}

function detailRow(label: string, value: unknown): string {
  return `<dt>${escapeHtml(label)}</dt><dd>${escapeHtml(valueOrDash(value))}</dd>`;
}

function recoveryCopy(lang: 'en' | 'zh', failure: GatewayStartupFailure): Record<string, string> {
  if (lang === 'en') {
    const schemaTooNew = failure.kind === 'database_schema_too_new';
    const migrationGap = failure.kind === 'database_migration_gap';
    const portInUse = failure.kind === 'port_in_use';
    return {
      eyebrow: 'Startup recovery',
      title: schemaTooNew
        ? 'Update xopc to open your local data'
        : migrationGap
          ? 'This build is missing a database migration'
          : portInUse
            ? 'The gateway port is already in use'
            : 'The local gateway could not start',
      body: schemaTooNew
        ? 'Your local database was created by a newer xopc version. To protect your data, this app stopped before opening it.'
        : migrationGap
          ? 'The app cannot safely migrate the local database because a required migration file is missing from this build.'
          : portInUse
            ? 'Another process is using the configured gateway port. Stop that process, change gateway.port, or retry after the port is free.'
            : 'xopc kept the desktop shell open so you can retry, update, or copy a clean diagnostic report.',
      kindLabel: 'Reason',
      dbVersionLabel: 'Database version',
      appVersionLabel: 'App schema version',
      portLabel: 'Gateway port',
      dbPathLabel: 'Database path',
      configPathLabel: 'Config path',
      safetyNote: schemaTooNew
        ? 'Your data has not been downgraded or modified. Update xopc, then retry opening it.'
        : migrationGap
          ? 'Your data has not been modified. Install a build that includes the missing migration, then retry.'
          : portInUse
            ? 'Your data is safe. Free the port or change gateway.port, then retry.'
            : 'Your data is safe. Use the diagnostic details if the issue keeps happening.',
      checkUpdate: failure.isPackaged ? 'Check for updates' : 'Check for packaged updates',
      installUpdate: 'Restart and install',
      retry: 'Retry gateway',
      openDataDir: 'Open data folder',
      copyDiagnostic: 'Copy diagnostic',
      devHint: 'Development build: rebuild the desktop and gateway bundles, then retry.',
      advancedTitle: 'Advanced options',
      diagnosticTitle: 'Diagnostic details',
      checking: 'Checking for updates...',
      updateAvailable: 'Update {version} is available. Downloading...',
      downloading: 'Downloading update: {percent}%',
      downloaded: 'Update {version} is ready to install.',
      notAvailable: 'No packaged update is available from the configured feed.',
      updateError: 'Update check failed: {message}',
      retrying: 'Retrying gateway startup...',
      retryFailed: 'Gateway still could not start.',
      openDirFailed: 'Could not open the data folder.',
      copied: 'Diagnostic copied.',
      copyFailed: 'Could not copy diagnostic.',
      noApi: 'Desktop recovery API is unavailable.',
    };
  }

  const schemaTooNew = failure.kind === 'database_schema_too_new';
  const migrationGap = failure.kind === 'database_migration_gap';
  const portInUse = failure.kind === 'port_in_use';
  return {
    eyebrow: '启动恢复',
    title: schemaTooNew
      ? '升级 xopc 后才能打开本地数据'
      : migrationGap
        ? '当前构建缺少数据库迁移'
        : portInUse
          ? '网关端口已被占用'
          : '本地网关未能启动',
    body: schemaTooNew
      ? '你的本地数据库由更新版本的 xopc 创建。为了避免损坏数据，当前应用已停止打开它。'
      : migrationGap
        ? '当前构建缺少必要的迁移文件，应用无法安全迁移本地数据库。'
        : portInUse
          ? '另一个进程正在使用配置的网关端口。请结束该进程、修改 gateway.port，或在端口释放后重试。'
          : 'xopc 保留了桌面恢复界面，你可以重试、更新，或复制干净的诊断信息。',
    kindLabel: '原因',
    dbVersionLabel: '数据库版本',
    appVersionLabel: '应用支持版本',
    portLabel: '网关端口',
    dbPathLabel: '数据库路径',
    configPathLabel: '配置路径',
    safetyNote: schemaTooNew
      ? '你的数据没有被降级或修改。升级 xopc 后重试即可继续打开。'
      : migrationGap
        ? '你的数据没有被修改。请安装包含缺失迁移的构建，然后重试。'
        : portInUse
          ? '你的数据是安全的。释放端口或修改 gateway.port 后重试。'
          : '你的数据是安全的。如果问题持续发生，请使用诊断信息排查。',
    checkUpdate: failure.isPackaged ? '检查更新' : '检查正式版更新',
    installUpdate: '重启并安装',
    retry: '重试网关',
    openDataDir: '打开数据目录',
    copyDiagnostic: '复制诊断信息',
    devHint: '开发构建：请重新构建桌面端和网关 bundle，然后重试。',
    advancedTitle: '高级选项',
    diagnosticTitle: '诊断详情',
    checking: '正在检查更新...',
    updateAvailable: '发现更新 {version}，正在下载...',
    downloading: '正在下载更新：{percent}%',
    downloaded: '更新 {version} 已准备好安装。',
    notAvailable: '当前更新源没有可用的正式版更新。',
    updateError: '检查更新失败：{message}',
    retrying: '正在重试启动网关...',
    retryFailed: '网关仍然未能启动。',
    openDirFailed: '无法打开数据目录。',
    copied: '诊断信息已复制。',
    copyFailed: '无法复制诊断信息。',
    noApi: '桌面恢复 API 不可用。',
  };
}

export function getStartupRecoveryPageDataUrl(
  appLocale: string,
  failure: GatewayStartupFailure,
): string {
  const lang = uiLangFromAppLocale(appLocale || 'en');
  const isEn = lang === 'en';
  const htmlLang = isEn ? 'en' : 'zh-CN';
  const copy = recoveryCopy(lang, failure);
  const diagnostic = JSON.stringify(failure, null, 2);
  const databaseVersionFailure =
    failure.kind === 'database_schema_too_new' || failure.kind === 'database_migration_gap';
  const showUpdatePrimary = Boolean(failure.isPackaged && databaseVersionFailure);
  const devCommand = [
    'pnpm install',
    'pnpm run build',
    'pnpm run electron:vite:build',
    'pnpm run electron:server:build',
    'pnpm run electron:extensions:build',
  ].join('\n');

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
      align-items: center;
      justify-content: center;
      padding: 2rem;
      font-family: ui-sans-serif, system-ui, -apple-system, "Segoe UI", Roboto, "PingFang SC", "Microsoft YaHei", sans-serif;
      background: #f8fafc;
      color: #0f172a;
    }
    main {
      width: min(48rem, 100%);
      border: 1px solid #cbd5e1;
      border-radius: 0.75rem;
      background: #ffffff;
      padding: 1.5rem;
      box-shadow: 0 18px 45px rgba(15, 23, 42, 0.10);
    }
    .eyebrow {
      margin: 0 0 0.5rem;
      font-size: 0.75rem;
      font-weight: 700;
      text-transform: uppercase;
      color: #2563eb;
    }
    h1 {
      margin: 0;
      font-size: 1.5rem;
      line-height: 1.25;
      font-weight: 700;
    }
    p {
      margin: 0.75rem 0 0;
      color: #475569;
      line-height: 1.6;
      font-size: 0.9375rem;
    }
    dl {
      display: grid;
      grid-template-columns: minmax(9rem, max-content) 1fr;
      gap: 0.5rem 1rem;
      margin: 1.25rem 0;
      padding: 1rem;
      border: 1px solid #e2e8f0;
      border-radius: 0.5rem;
      background: #f8fafc;
      font-size: 0.875rem;
    }
    dt { color: #64748b; }
    dd {
      margin: 0;
      min-width: 0;
      color: #0f172a;
      word-break: break-word;
      font-family: ui-monospace, SFMono-Regular, Consolas, "Liberation Mono", monospace;
    }
    .actions {
      display: flex;
      flex-wrap: wrap;
      gap: 0.75rem;
      margin-top: 1.25rem;
    }
    button {
      border: 1px solid #cbd5e1;
      border-radius: 0.5rem;
      background: #fff;
      color: #0f172a;
      padding: 0.625rem 0.875rem;
      font: inherit;
      font-size: 0.875rem;
      cursor: pointer;
    }
    button.primary {
      border-color: #2563eb;
      background: #2563eb;
      color: #fff;
      font-weight: 650;
    }
    button:disabled {
      cursor: not-allowed;
      opacity: 0.6;
    }
    .dev {
      display: ${failure.isPackaged ? 'none' : 'block'};
      margin-top: 1.25rem;
    }
    .notice {
      margin-top: 1rem;
      border: 1px solid #bfdbfe;
      border-radius: 0.5rem;
      background: #eff6ff;
      color: #1e3a8a;
      padding: 0.75rem 0.875rem;
      font-size: 0.875rem;
      line-height: 1.5;
    }
    pre {
      overflow: auto;
      max-height: 11rem;
      margin: 0.75rem 0 0;
      border-radius: 0.5rem;
      background: #0f172a;
      color: #e2e8f0;
      padding: 0.875rem;
      font-size: 0.8125rem;
      line-height: 1.5;
      white-space: pre-wrap;
      word-break: break-word;
    }
    details {
      margin-top: 1.25rem;
      color: #475569;
      font-size: 0.875rem;
    }
    summary { cursor: pointer; }
    #status {
      margin-top: 1rem;
      min-height: 1.25rem;
      font-size: 0.875rem;
      color: #475569;
    }
    @media (prefers-color-scheme: dark) {
      body { background: #020617; color: #e2e8f0; }
      main { border-color: #334155; background: #0f172a; box-shadow: none; }
      p, details, #status { color: #94a3b8; }
      .notice { border-color: #1d4ed8; background: rgba(30, 64, 175, 0.18); color: #bfdbfe; }
      dl { border-color: #334155; background: #111827; }
      dt { color: #94a3b8; }
      dd { color: #e2e8f0; }
      button { border-color: #475569; background: #111827; color: #e2e8f0; }
      button.primary { border-color: #3b82f6; background: #2563eb; color: #fff; }
      pre { background: #020617; }
    }
  </style>
</head>
<body>
  <main>
    <p class="eyebrow">${escapeHtml(copy.eyebrow)}</p>
    <h1>${escapeHtml(copy.title)}</h1>
    <p>${escapeHtml(copy.body)}</p>
    <div class="notice">${escapeHtml(copy.safetyNote)}</div>
    <dl>
      ${detailRow(copy.kindLabel, failure.kind)}
      ${detailRow(copy.dbVersionLabel, valueOrDash(failure.dbVersion))}
      ${detailRow(copy.appVersionLabel, valueOrDash(failure.appVersion))}
      ${detailRow(copy.portLabel, valueOrDash(failure.port))}
      ${detailRow(copy.dbPathLabel, failure.dbPath)}
      ${detailRow(copy.configPathLabel, failure.configPath)}
    </dl>
    <div class="actions">
      ${showUpdatePrimary ? `<button id="check" class="primary">${escapeHtml(copy.checkUpdate)}</button>` : ''}
      <button id="install" class="primary" style="display:none">${escapeHtml(copy.installUpdate)}</button>
      <button id="retry" class="${showUpdatePrimary ? '' : 'primary'}">${escapeHtml(copy.retry)}</button>
      <button id="copy">${escapeHtml(copy.copyDiagnostic)}</button>
    </div>
    <p id="status"></p>
    <section class="dev">
      <p>${escapeHtml(copy.devHint)}</p>
      <pre>${escapeHtml(devCommand)}</pre>
    </section>
    <details>
      <summary>${escapeHtml(copy.advancedTitle)}</summary>
      <div class="actions">
        <button id="open-dir">${escapeHtml(copy.openDataDir)}</button>
      </div>
      <p>${escapeHtml(copy.diagnosticTitle)}</p>
      <pre>${escapeHtml(diagnostic)}</pre>
    </details>
  </main>
  <script>
    (function () {
      var copy = ${JSON.stringify(copy)};
      var api = window.electronAPI && window.electronAPI.startup;
      var statusEl = document.getElementById('status');
      var checkBtn = document.getElementById('check');
      var installBtn = document.getElementById('install');
      var retryBtn = document.getElementById('retry');
      var openDirBtn = document.getElementById('open-dir');
      var copyBtn = document.getElementById('copy');

      function setStatus(text) {
        if (statusEl) statusEl.textContent = text || '';
      }

      function renderUpdateStatus(status) {
        if (!status || !status.state) return;
        if (status.state === 'checking') setStatus(copy.checking);
        else if (status.state === 'available') setStatus(copy.updateAvailable.replace('{version}', status.version || ''));
        else if (status.state === 'downloading') setStatus(copy.downloading.replace('{percent}', Math.max(0, Math.min(100, status.percent || 0)).toFixed(0)));
        else if (status.state === 'downloaded') {
          setStatus(copy.downloaded.replace('{version}', status.version || ''));
          if (installBtn) installBtn.style.display = '';
        } else if (status.state === 'not-available') setStatus(copy.notAvailable);
        else if (status.state === 'error') setStatus(copy.updateError.replace('{message}', status.message || ''));
      }

      if (!api) {
        setStatus(copy.noApi);
        return;
      }

      api.getUpdateStatus().then(renderUpdateStatus).catch(function () {});
      if (typeof api.onUpdateStatusChanged === 'function') api.onUpdateStatusChanged(renderUpdateStatus);

      checkBtn && checkBtn.addEventListener('click', function () {
        setStatus(copy.checking);
        api.checkUpdate().then(function (result) {
          if (result && result.ok === false) setStatus(result.message || copy.updateError.replace('{message}', ''));
        }).catch(function (err) {
          setStatus(String(err && err.message ? err.message : err));
        });
      });
      installBtn && installBtn.addEventListener('click', function () {
        api.quitAndInstall().catch(function (err) {
          setStatus(String(err && err.message ? err.message : err));
        });
      });
      retryBtn && retryBtn.addEventListener('click', function () {
        retryBtn.disabled = true;
        setStatus(copy.retrying);
        retryGateway().then(function (result) {
          if (!result || result.ok === false) {
            retryBtn.disabled = false;
            setStatus((result && result.message) || copy.retryFailed);
          }
        }).catch(function (err) {
          retryBtn.disabled = false;
          setStatus(String(err && err.message ? err.message : err));
        });
      });
      openDirBtn && openDirBtn.addEventListener('click', function () {
        api.openDataDir().then(function (result) {
          if (result && result.ok === false) setStatus(result.message || copy.openDirFailed);
        }).catch(function (err) {
          setStatus(String(err && err.message ? err.message : err));
        });
      });
      copyBtn && copyBtn.addEventListener('click', function () {
        api.copyDiagnostic().then(function (result) {
          setStatus(result && result.ok ? copy.copied : (result && result.message) || copy.copyFailed);
        }).catch(function (err) {
          setStatus(String(err && err.message ? err.message : err));
        });
      });

      function retryGateway() {
        return api.retryGateway();
      }
    })();
  </script>
</body>
</html>`;
  return `data:text/html;charset=utf-8,${encodeURIComponent(html)}`;
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

export function getRendererCrashPageDataUrl(
  appLocale: string,
  detail: string,
  options: { openedExternal?: boolean } = {},
): string {
  const lang = uiLangFromAppLocale(appLocale || 'en');
  const isEn = lang === 'en';
  const htmlLang = isEn ? 'en' : 'zh-CN';
  const title = isEn ? 'Renderer crashed' : '渲染进程已崩溃';
  const body = isEn
    ? 'The local gateway is running, but the desktop renderer crashed while loading the console.'
    : '本地网关已启动，但桌面渲染进程在加载控制台时崩溃。';
  const hint = isEn
    ? 'Restart the app. If it still happens, send the startup log and crash dump path below.'
    : '请重启应用。若仍然发生，请提供下方启动日志信息和崩溃转储路径。';
  const external = options.openedExternal
    ? isEn
      ? 'The console was also opened in your default browser as a fallback.'
      : '控制台已作为降级方案在默认浏览器中打开。'
    : '';
  const escapedDetail = detail.replace(/[&<>"']/g, (ch) => {
    switch (ch) {
      case '&': return '&amp;';
      case '<': return '&lt;';
      case '>': return '&gt;';
      case '"': return '&quot;';
      case "'": return '&#39;';
      default: return ch;
    }
  });
  const html = `<!DOCTYPE html>
<html lang="${htmlLang}">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <title>xopc</title>
  <style>
    body {
      margin: 0;
      min-height: 100vh;
      display: flex;
      align-items: center;
      justify-content: center;
      padding: 2rem;
      font-family: ui-sans-serif, system-ui, -apple-system, "Segoe UI", Roboto, "PingFang SC", "Microsoft YaHei", sans-serif;
      background: #0f172a;
      color: #e2e8f0;
    }
    main {
      width: min(42rem, 100%);
      border: 1px solid #334155;
      border-radius: 1rem;
      background: #111827;
      padding: 1.5rem;
    }
    h1 { margin: 0; font-size: 1.25rem; }
    p { color: #94a3b8; line-height: 1.55; }
    pre {
      overflow: auto;
      border-radius: 0.75rem;
      background: #020617;
      color: #cbd5e1;
      padding: 1rem;
      font-size: 0.8125rem;
      white-space: pre-wrap;
      word-break: break-word;
    }
  </style>
</head>
<body>
  <main>
    <h1>${title}</h1>
    <p>${body}</p>
    ${external ? `<p>${external}</p>` : ''}
    <p>${hint}</p>
    <pre>${escapedDetail}</pre>
  </main>
</body>
</html>`;
  return `data:text/html;charset=utf-8,${encodeURIComponent(html)}`;
}
