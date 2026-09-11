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
            ? 'The local service port is already in use'
            : 'xopc could not start',
      body: schemaTooNew
        ? 'Your local database was created by a newer xopc version. To protect your data, this app stopped before opening it.'
        : migrationGap
          ? 'The app cannot safely migrate the local database because a required migration file is missing from this build.'
          : portInUse
            ? 'Another process is using the port xopc needs. Stop that process, choose another local port, or retry after the port is free.'
            : 'xopc kept the desktop shell open so you can retry, update, or copy a clean diagnostic report.',
      kindLabel: 'Reason',
      dbVersionLabel: 'Database version',
      appVersionLabel: 'App schema version',
      portLabel: 'Local service port',
      dbPathLabel: 'Database path',
      configPathLabel: 'Config path',
      safetyNote: schemaTooNew
        ? 'Your data has not been downgraded or modified. Update xopc, then retry opening it.'
        : migrationGap
          ? 'Your data has not been modified. Install a build that includes the missing migration, then retry.'
          : portInUse
            ? 'Your data is safe. Free the port or choose another local port, then retry.'
            : 'Your data is safe. Use the diagnostic details if the issue keeps happening.',
      checkUpdate: failure.isPackaged ? 'Check for updates' : 'Check for packaged updates',
      installUpdate: 'Restart and install',
      retry: 'Retry startup',
      openDataDir: 'Open data folder',
      copyDiagnostic: 'Collect and copy report',
      devHint: 'Development build: rebuild the desktop and local service bundles, then retry.',
      advancedTitle: 'Advanced options',
      diagnosticTitle: 'Diagnostic details',
      checking: 'Checking for updates...',
      updateAvailable: 'Update {version} is available. Downloading...',
      downloading: 'Downloading update: {percent}%',
      downloaded: 'Update {version} is ready to install.',
      notAvailable: 'No packaged update is available from the configured feed.',
      updateError: 'Update check failed: {message}',
      retrying: 'Retrying xopc startup...',
      retryFailed: 'xopc still could not start.',
      openDirFailed: 'Could not open the data folder.',
      copied: 'Redacted diagnostic report copied.',
      copyFailed: 'Could not collect diagnostics. Run `xopc support report` in a terminal.',
      collectingDiagnostic: 'Collecting diagnostics...',
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
          ? '本地服务端口已被占用'
          : 'xopc 未能启动',
    body: schemaTooNew
      ? '你的本地数据库由更新版本的 xopc 创建。为了避免损坏数据，当前应用已停止打开它。'
      : migrationGap
        ? '当前构建缺少必要的迁移文件，应用无法安全迁移本地数据库。'
        : portInUse
          ? '另一个进程正在使用 xopc 所需的端口。请结束该进程、选择其他本地端口，或在端口释放后重试。'
          : 'xopc 保留了桌面恢复界面，你可以重试、更新，或复制干净的诊断信息。',
    kindLabel: '原因',
    dbVersionLabel: '数据库版本',
    appVersionLabel: '应用支持版本',
    portLabel: '本地服务端口',
    dbPathLabel: '数据库路径',
    configPathLabel: '配置路径',
    safetyNote: schemaTooNew
      ? '你的数据没有被降级或修改。升级 xopc 后重试即可继续打开。'
      : migrationGap
        ? '你的数据没有被修改。请安装包含缺失迁移的构建，然后重试。'
        : portInUse
          ? '你的数据是安全的。释放端口或选择其他本地端口后重试。'
          : '你的数据是安全的。如果问题持续发生，请使用诊断信息排查。',
    checkUpdate: failure.isPackaged ? '检查更新' : '检查正式版更新',
    installUpdate: '重启并安装',
    retry: '重新启动',
    openDataDir: '打开数据目录',
    copyDiagnostic: '收集并复制报告',
    devHint: '开发构建：请重新构建桌面端和本地服务 bundle，然后重试。',
    advancedTitle: '高级选项',
    diagnosticTitle: '诊断详情',
    checking: '正在检查更新...',
    updateAvailable: '发现更新 {version}，正在下载...',
    downloading: '正在下载更新：{percent}%',
    downloaded: '更新 {version} 已准备好安装。',
    notAvailable: '当前更新源没有可用的正式版更新。',
    updateError: '检查更新失败：{message}',
    retrying: '正在重新启动 xopc...',
    retryFailed: 'xopc 仍然未能启动。',
    openDirFailed: '无法打开数据目录。',
    copied: '已复制脱敏后的诊断报告。',
    copyFailed: '诊断信息收集失败，请在终端运行 `xopc support report`。',
    collectingDiagnostic: '正在收集诊断信息…',
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
        copyBtn.disabled = true;
        setStatus(copy.collectingDiagnostic);
        api.copyDiagnostic().then(function (result) {
          setStatus(result && result.ok ? copy.copied : (result && result.message) || copy.copyFailed);
        }).catch(function (err) {
          setStatus(String(err && err.message ? err.message : err));
        }).finally(function () {
          copyBtn.disabled = false;
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
  const eyebrow = isEn ? 'LOCAL SERVICE' : '本地服务';
  const title = isEn ? 'Starting xopc' : '正在启动 xopc';
  const hint = isEn ? 'Preparing local services…' : '正在准备本地服务…';
  const service = isEn ? 'xopc · Running locally' : 'xopc · 本地运行';
  const privacy = isEn ? 'Local-first · Your data stays yours' : '本地优先 · 你的数据由你掌控';
  const slowHint = isEn
    ? 'First launch or an update can take a little longer.'
    : '首次启动或更新后可能需要更长时间。';
  const verySlowHint = isEn
    ? 'Still working locally — xopc will keep trying.'
    : '仍在本地处理中，xopc 会继续尝试。';
  const phaseCopy = isEn
    ? {
        'preparing-workspace': 'Preparing your workspace…',
        'checking-core': 'Checking local services…',
        'starting-core': 'Starting local intelligence…',
        'connecting-assistant': 'Connecting your assistant…',
        'opening-workspace': 'Opening your workspace…',
      }
    : {
        'preparing-workspace': '正在准备工作空间…',
        'checking-core': '正在检查本地服务…',
        'starting-core': '正在启动本地智能服务…',
        'connecting-assistant': '正在连接你的助手…',
        'opening-workspace': '正在打开工作空间…',
      };

  const html = `<!DOCTYPE html>
<html lang="${htmlLang}">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <title>xopc</title>
  <style>
    :root {
      --startup-progress: 8%;
      --canvas: #f5f5f7;
      --ink: #1d1d1f;
      --muted: #6e6e73;
      --faint: #86868b;
      --edge: rgba(60, 60, 67, 0.13);
      --track: rgba(60, 60, 67, 0.11);
      --glass: rgba(255, 255, 255, 0.68);
      --ai: #1d1d1f;
      --ai-highlight: #57575c;
      --ai-shadow: #070708;
      --human: #007aff;
      --human-highlight: #66b5ff;
      --human-shadow: #0062cc;
    }
    * { box-sizing: border-box; }
    body {
      margin: 0;
      min-height: 100vh;
      display: grid;
      place-items: center;
      padding: 2rem;
      overflow: hidden;
      background:
        radial-gradient(circle at 50% 38%, rgba(0, 122, 255, 0.09), transparent 24rem),
        linear-gradient(180deg, #fafafa 0%, var(--canvas) 100%);
      color: var(--ink);
      font-family: -apple-system, BlinkMacSystemFont, "SF Pro Display", "SF Pro Text", "Helvetica Neue", "PingFang SC", "Microsoft YaHei", sans-serif;
      -webkit-font-smoothing: antialiased;
    }
    body::before {
      content: "";
      position: fixed;
      inset: 0;
      pointer-events: none;
      background:
        radial-gradient(circle at 22% 18%, rgba(255, 255, 255, 0.9), transparent 24rem),
        radial-gradient(circle at 78% 76%, rgba(0, 122, 255, 0.035), transparent 25rem);
    }
    .card {
      position: relative;
      z-index: 1;
      width: min(31rem, 100%);
      padding: 2.25rem 2.25rem 2rem;
      border: 1px solid rgba(255, 255, 255, 0.78);
      border-radius: 2rem;
      background: var(--glass);
      box-shadow:
        inset 0 1px 0 rgba(255, 255, 255, 0.86),
        0 1.5rem 5rem rgba(0, 0, 0, 0.08);
      text-align: center;
      -webkit-backdrop-filter: blur(32px) saturate(150%);
      backdrop-filter: blur(32px) saturate(150%);
      transition:
        opacity 120ms ease,
        transform 140ms cubic-bezier(0.4, 0, 1, 1);
    }
    .is-ready .card {
      opacity: 0;
      transform: translateY(-0.25rem) scale(0.985);
    }
    .eyebrow {
      margin-bottom: 1.35rem;
      color: var(--faint);
      font-size: 0.66rem;
      font-weight: 650;
      letter-spacing: 0.16em;
    }
    .mark-wrap {
      position: relative;
      display: grid;
      width: 8.25rem;
      height: 8.25rem;
      margin: 0 auto 1.45rem;
      place-items: center;
    }
    .mark-wrap::before {
      content: "";
      position: absolute;
      inset: 0.45rem;
      border: 1px solid rgba(0, 122, 255, 0.12);
      border-radius: 50%;
      background: rgba(255, 255, 255, 0.36);
      box-shadow:
        inset 0 1px 0 rgba(255, 255, 255, 0.72),
        0 0 3.5rem rgba(0, 122, 255, 0.13);
      animation: shell-breathe 2.4s ease-in-out infinite;
    }
    .loop-logo {
      position: relative;
      z-index: 1;
      display: block;
      width: 6.15rem;
      height: 6.15rem;
      overflow: visible;
      filter: drop-shadow(0 0.75rem 1.25rem rgba(0, 0, 0, 0.08));
    }
    .loop-logo circle {
      fill: none;
      stroke-linecap: round;
    }
    .loop-ambient {
      stroke: var(--human);
      stroke-width: 174;
      opacity: 0;
      filter: blur(28px);
      animation: loop-ambient 4.8s cubic-bezier(.22, 1, .36, 1) infinite;
    }
    .loop-origin {
      stroke: url(#startup-human-glass);
      stroke-width: 136;
      opacity: 0;
      animation: loop-origin 4.8s cubic-bezier(.22, 1, .36, 1) infinite;
    }
    .loop-ai,
    .loop-ai-glow {
      stroke-width: 136;
      animation: loop-ai-fill 4.8s cubic-bezier(.4, 0, .16, 1) infinite;
    }
    .loop-ai-glow {
      stroke: var(--human-highlight);
      stroke-width: 166;
      opacity: 0;
      filter: blur(18px);
      animation-name: loop-ai-glow;
    }
    .loop-human {
      stroke-width: 136;
      opacity: 1;
      animation: loop-human-settle 4.8s cubic-bezier(.22, 1, .36, 1) infinite;
    }
    .loop-liquid-front {
      stroke: rgba(255, 255, 255, 0.96);
      stroke-width: 36;
      opacity: 0;
      filter: drop-shadow(0 0 16px var(--human-highlight));
      animation: loop-liquid-front 4.8s cubic-bezier(.4, 0, .16, 1) infinite;
    }
    h1 {
      margin: 0;
      font-size: clamp(1.45rem, 4vw, 1.85rem);
      font-weight: 650;
      letter-spacing: -0.035em;
      line-height: 1.2;
    }
    .service {
      margin-top: 0.55rem;
      color: var(--faint);
      font-size: 0.76rem;
      font-weight: 520;
    }
    .status {
      width: min(18rem, 84%);
      margin: 1.55rem auto 0;
    }
    #hint {
      min-height: 1.3rem;
      margin: 0 0 0.75rem;
      color: var(--muted);
      font-size: 0.84rem;
      line-height: 1.5;
      transition: opacity 180ms ease;
    }
    .progress-track {
      position: relative;
      height: 0.25rem;
      overflow: hidden;
      border-radius: 999px;
      background: var(--track);
    }
    .progress-fill {
      position: absolute;
      inset: 0 auto 0 0;
      width: var(--startup-progress);
      border-radius: inherit;
      background: linear-gradient(90deg, var(--human-shadow), var(--human-highlight));
      box-shadow: 0 0 0.8rem rgba(0, 122, 255, 0.28);
      transition: width 520ms cubic-bezier(.2, .8, .2, 1);
    }
    .progress-fill::after {
      content: "";
      position: absolute;
      inset: 0;
      width: 42%;
      background: linear-gradient(90deg, transparent, rgba(255, 255, 255, 0.82), transparent);
      animation: progress-flow 1.15s ease-in-out infinite;
    }
    #slow {
      display: none;
      margin: 0.75rem 0 0;
      color: var(--faint);
      font-size: 0.74rem;
      line-height: 1.45;
    }
    .privacy {
      display: inline-flex;
      align-items: center;
      gap: 0.4rem;
      margin-top: 1.85rem;
      color: var(--faint);
      font-size: 0.69rem;
      letter-spacing: 0.01em;
    }
    .privacy::before {
      content: "";
      width: 0.34rem;
      height: 0.34rem;
      border-radius: 50%;
      background: #34c759;
      box-shadow: 0 0 0 0.2rem rgba(52, 199, 89, 0.1);
    }
    @keyframes shell-breathe {
      0%, 100% { opacity: 0.76; transform: scale(0.96); }
      50% { opacity: 1; transform: scale(1.025); }
    }
    @keyframes loop-origin {
      0%, 38% { opacity: 1; }
      49%, 79% { opacity: 0; }
      91%, 100% { opacity: 1; }
    }
    @keyframes loop-ai-fill {
      0%, 5% { opacity: 0; stroke-dasharray: 0 2073.451151; }
      11% { opacity: 1; }
      44%, 80% { opacity: 1; stroke-dasharray: 1419.162121 654.289030; }
      91% { opacity: 0; stroke-dasharray: 1419.162121 654.289030; }
      100% { opacity: 0; stroke-dasharray: 0 2073.451151; }
    }
    @keyframes loop-ai-glow {
      0%, 5% { opacity: 0; stroke-dasharray: 0 2073.451151; }
      14%, 38% { opacity: 0.24; }
      48%, 100% { opacity: 0; stroke-dasharray: 1419.162121 654.289030; }
    }
    @keyframes loop-human-settle {
      0%, 38% { opacity: 0; }
      49%, 80% { opacity: 1; }
      91%, 100% { opacity: 0; }
    }
    @keyframes loop-liquid-front {
      0%, 5% { opacity: 0; stroke-dashoffset: 0; }
      11%, 38% { opacity: 0.9; }
      48%, 100% { opacity: 0; stroke-dashoffset: -1394; }
    }
    @keyframes loop-ambient {
      0% { opacity: 0.18; transform: scale(0.92); transform-origin: center; }
      44% { opacity: 0.07; }
      52%, 82% { opacity: 0; transform: scale(1.04); transform-origin: center; }
      94%, 100% { opacity: 0.18; transform: scale(0.92); transform-origin: center; }
    }
    @keyframes progress-flow {
      from { transform: translateX(-130%); }
      to { transform: translateX(340%); }
    }
    @media (max-height: 620px) {
      .card { padding-block: 1.5rem; }
      .mark-wrap { width: 6.75rem; height: 6.75rem; margin-bottom: 1rem; }
      .loop-logo { width: 5rem; height: 5rem; }
      .privacy { margin-top: 1.3rem; }
    }
    @media (prefers-color-scheme: dark) {
      :root {
        --canvas: #0c0c0e;
        --ink: #f5f5f7;
        --muted: #a1a1a6;
        --faint: #727277;
        --edge: rgba(255, 255, 255, 0.11);
        --track: rgba(255, 255, 255, 0.1);
        --glass: rgba(30, 30, 32, 0.68);
        --ai: #f5f5f7;
        --ai-highlight: #ffffff;
        --ai-shadow: #c9c9ce;
        --human: #0a84ff;
        --human-highlight: #67b7ff;
        --human-shadow: #006edb;
      }
      body {
        background:
          radial-gradient(circle at 50% 38%, rgba(10, 132, 255, 0.14), transparent 25rem),
          linear-gradient(180deg, #17171a 0%, var(--canvas) 100%);
      }
      body::before {
        background:
          radial-gradient(circle at 22% 18%, rgba(255, 255, 255, 0.025), transparent 23rem),
          radial-gradient(circle at 78% 76%, rgba(10, 132, 255, 0.055), transparent 25rem);
      }
      .card {
        border-color: var(--edge);
        box-shadow:
          inset 0 1px 0 rgba(255, 255, 255, 0.08),
          0 2rem 6rem rgba(0, 0, 0, 0.34);
      }
      .mark-wrap::before {
        border-color: rgba(10, 132, 255, 0.13);
        background: rgba(255, 255, 255, 0.025);
        box-shadow:
          inset 0 1px 0 rgba(255, 255, 255, 0.07),
          0 0 4rem rgba(10, 132, 255, 0.16);
      }
    }
    @media (prefers-reduced-motion: reduce) {
      .mark-wrap::before,
      .loop-logo circle,
      .progress-fill::after {
        animation: none;
      }
      .loop-origin, .loop-ai-glow, .loop-liquid-front { opacity: 0; }
      .loop-ai { opacity: 1; stroke-dasharray: 1419.162121 654.289030; }
      .loop-human { opacity: 1; }
    }
  </style>
</head>
<body>
  <div class="card">
    <div class="eyebrow">${eyebrow}</div>
    <div class="mark-wrap" aria-hidden="true">
      <svg class="loop-logo" viewBox="0 0 1024 1024" aria-hidden="true">
        <defs>
          <linearGradient id="startup-ai-glass" x1="198" y1="180" x2="826" y2="844" gradientUnits="userSpaceOnUse">
            <stop stop-color="var(--ai-highlight)" />
            <stop offset="0.46" stop-color="var(--ai)" />
            <stop offset="1" stop-color="var(--ai-shadow)" />
          </linearGradient>
          <linearGradient id="startup-human-glass" x1="340" y1="224" x2="700" y2="816" gradientUnits="userSpaceOnUse">
            <stop stop-color="var(--human-highlight)" />
            <stop offset="0.52" stop-color="var(--human)" />
            <stop offset="1" stop-color="var(--human-shadow)" />
          </linearGradient>
        </defs>
        <circle class="loop-ambient" cx="512" cy="512" r="330" />
        <circle class="loop-origin" cx="512" cy="512" r="330" />
        <circle class="loop-ai-glow" cx="512" cy="512" r="330" stroke-dasharray="1419.162121 654.289030" transform="rotate(11.8 512 512)" />
        <circle class="loop-ai" cx="512" cy="512" r="330" stroke="url(#startup-ai-glass)" stroke-dasharray="1419.162121 654.289030" transform="rotate(11.8 512 512)" />
        <circle class="loop-human" cx="512" cy="512" r="330" stroke="url(#startup-human-glass)" stroke-dasharray="354.790530 1718.660621" transform="rotate(284.2 512 512)" />
        <circle class="loop-liquid-front" cx="512" cy="512" r="330" stroke-dasharray="58 2015.451151" transform="rotate(11.8 512 512)" />
      </svg>
    </div>
    <h1>${title}</h1>
    <p class="service">${service}</p>
    <div class="status" role="status" aria-live="polite" aria-atomic="true">
      <p id="hint">${hint}</p>
      <div class="progress-track" aria-hidden="true">
        <div class="progress-fill"></div>
      </div>
      <p id="slow"></p>
    </div>
    <p class="privacy">${privacy}</p>
  </div>
  <script>
    (function () {
      var phases = ${JSON.stringify(phaseCopy)};
      var progressByPhase = {
        'preparing-workspace': 12,
        'checking-core': 30,
        'starting-core': 52,
        'connecting-assistant': 76,
        'opening-workspace': 100
      };
      var slowHint = ${JSON.stringify(slowHint)};
      var verySlowHint = ${JSON.stringify(verySlowHint)};
      var hint = document.getElementById('hint');
      var slow = document.getElementById('slow');
      var api = window.electronAPI && window.electronAPI.startup;

      if (api && typeof api.onProgress === 'function') {
        api.onProgress(function (detail) {
          var text = detail && phases[detail.phase];
          if (hint && text) hint.textContent = text;
          var progress = detail && progressByPhase[detail.phase];
          if (progress) document.documentElement.style.setProperty('--startup-progress', progress + '%');
          if (detail && detail.phase === 'opening-workspace') {
            document.documentElement.classList.add('is-ready');
          }
        });
      }

      window.setTimeout(function () {
        if (!slow) return;
        slow.textContent = slowHint;
        slow.style.display = 'block';
      }, 10000);
      window.setTimeout(function () {
        if (slow) slow.textContent = verySlowHint;
      }, 20000);
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
    ? 'The local service is running, but the desktop view crashed while loading.'
    : '本地服务已启动，但桌面界面在加载时崩溃。';
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
