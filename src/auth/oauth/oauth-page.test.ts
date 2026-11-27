import { execFileSync } from 'node:child_process';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

import { describe, expect, it } from 'vitest';

import { oauthErrorHtml as googleOAuthErrorHtml, oauthSuccessHtml as googleOAuthSuccessHtml } from './google-oauth/oauth-page.js';
import { oauthErrorHtml, oauthSuccessHtml, renderOAuthCallbackPage } from './oauth-page.js';

describe('xopc unified OAuth callback page', () => {
  it('renders xopc branding and strips redundant trailing close copy', () => {
    const html = oauthSuccessHtml('Signed in to the MCP server. You may now close this page.');

    expect(html).toContain('class="logo-mark"');
    expect(html).toContain('<span class="brand-name">xopc</span>');
    expect(html).toContain('Authentication successful · xopc');
    expect(html).toContain('Signed in to the MCP server.');
    expect(html).not.toContain('Signed in to the MCP server. You may now close this page.');
    expect(html).toContain('You can safely close this window and return to xopc.');
    expect(html).not.toContain('#F09082');
  });

  it('escapes untrusted message, details, and title content and rejects non-xopc deep links', () => {
    const html = renderOAuthCallbackPage({
      title: '<script>alert(1)</script>',
      message: 'Failed for <b>provider</b>',
      details: 'error="bad" & <trace>',
      tone: 'error',
      returnToAppUrl: 'javascript:alert(1)',
    });

    expect(html).toContain('&lt;script&gt;alert(1)&lt;/script&gt;');
    expect(html).toContain('Failed for &lt;b&gt;provider&lt;/b&gt;');
    expect(html).toContain('<div class="details">error=&quot;bad&quot; &amp; &lt;trace&gt;</div>');
    expect(html).not.toContain('id="return-to-xopc"');
    expect(html).not.toContain('javascript:alert(1)');
  });

  it('renders a return-to-app link for safe xopc:// deep links', () => {
    const html = oauthSuccessHtml('Authorization finished.', {
      title: 'Authorization complete',
      returnToAppUrl: 'xopc://cloud/model-connected?request_id=abc',
    });

    expect(html).toContain('id="return-to-xopc"');
    expect(html).toContain('href="xopc://cloud/model-connected?request_id=abc"');
  });

  it('shares the same renderer with Google OAuth callback helpers', () => {
    expect(googleOAuthSuccessHtml('Google authentication completed. You can close this window.')).toBe(
      oauthSuccessHtml('Google authentication completed. You can close this window.'),
    );
    expect(googleOAuthErrorHtml('Google authentication did not complete.', 'Error: access_denied')).toBe(
      oauthErrorHtml('Google authentication did not complete.', 'Error: access_denied'),
    );
  });

  it('redirects @earendil-works/pi-ai oauth-page in Vitest and real Node/tsx subprocesses', async () => {
    const piPage = await import('@earendil-works/pi-ai/utils/oauth-page');
    const vitestHtml = piPage.oauthSuccessHtml('Signed in to Anthropic. You may now close this page.');
    expect(vitestHtml).toContain('class="brand-name">xopc<');
    expect(vitestHtml).not.toContain('#F09082');

    const hookUrl = pathToFileURL(resolve(process.cwd(), 'src/auth/oauth/pi-oauth-page-hook.ts')).href;
    const script = [
      `const { registerPiOAuthPageHook } = await import(${JSON.stringify(hookUrl)});`,
      'registerPiOAuthPageHook();',
      'const piPage = await import("@earendil-works/pi-ai/utils/oauth-page");',
      'const callbackServerUrl = new URL("./auth/oauth/callback-server.js", import.meta.resolve("@earendil-works/pi-ai")).href;',
      'const { startOAuthCallbackServer } = await import(callbackServerUrl);',
      'const server = await startOAuthCallbackServer({ providerName: "Anthropic", host: "127.0.0.1", port: 0, path: "/callback", state: "s1", complete: async () => "ok" });',
      'try {',
      '  const res = await fetch(`${server.redirectUri}?code=c1&state=s1`);',
      '  const body = await res.text();',
      '  await server.wait();',
      '  const direct = piPage.oauthErrorHtml("MCP failed.", "detail");',
      '  console.log(JSON.stringify({ status: res.status, hasXopc: body.includes("brand-name\\">xopc<"), hasPiLogo: body.includes("#F09082"), hasProvider: body.includes("Signed in to Anthropic."), directHasXopc: direct.includes("brand-name\\">xopc<") }));',
      '} finally { server.close(); }',
    ].join('\n');

    const stdout = execFileSync(process.execPath, ['--import', 'tsx/esm', '-e', script], {
      cwd: process.cwd(),
      encoding: 'utf8',
    });
    expect(JSON.parse(stdout.trim())).toEqual({
      status: 200,
      hasXopc: true,
      hasPiLogo: false,
      hasProvider: true,
      directHasXopc: true,
    });
  });

  it('replaces pi-ai oauth-page with xopc oauth-page in esbuild bundles', async () => {
    const esbuild = await import('esbuild');
    const { electronPiRuntimePlugin } = await import('../../../scripts/electron-pi-runtime.mjs');
    const result = await esbuild.build({
      stdin: {
        contents: 'export { oauthSuccessHtml, oauthErrorHtml } from "@earendil-works/pi-ai/utils/oauth-page";',
        resolveDir: process.cwd(),
        loader: 'js',
      },
      bundle: true,
      write: false,
      format: 'esm',
      platform: 'node',
      plugins: [electronPiRuntimePlugin()],
    });
    const bundled = result.outputFiles[0]?.text ?? '';
    expect(bundled).toContain('brand-name">xopc<');
    expect(bundled).not.toContain('#F09082');
  });
});
