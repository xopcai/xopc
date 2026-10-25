import { renderToStaticMarkup } from 'react-dom/server';
import { expect, it } from 'vitest';
import { PluginScopePreview } from './plugin-scope-preview';
import type { ExtensionMarketplacePackageDetail } from './extension-marketplace-api';
it.each(['content', 'network', 'local-exec'] as const)('previews the declared scope and unknowns for a %s plugin', riskTier => {
  const data = { latestVersion: { riskTier, componentIndex: { skills: ['summarize'], mcpServers: [{ name: 'sample', transport: 'stdio' }] } } } as ExtensionMarketplacePackageDetail;
  const html = renderToStaticMarkup(<PluginScopePreview data={data} zh />);
  expect(html).toContain('summarize'); expect(html).toContain('sample (stdio)');
  expect(html).toContain('发布者认证只验证来源');
  expect(html).toContain('未列出权限不代表没有');
  if (riskTier === 'local-exec') expect(html).toContain('本机代码执行');
  if (riskTier === 'network') expect(html).toContain('账号授权');
});
it('never translates missing metadata into a no-permissions claim', () => {
  const html = renderToStaticMarkup(<PluginScopePreview data={{ latestVersion: {} } as ExtensionMarketplacePackageDetail} zh />);
  expect(html).toContain('目录未提供清单'); expect(html).toContain('目录未声明');
});
