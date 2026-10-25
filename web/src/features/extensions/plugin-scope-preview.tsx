import type { ExtensionMarketplacePackageDetail } from './extension-marketplace-api';
export function PluginScopePreview({ data, zh }: { data: ExtensionMarketplacePackageDetail; zh: boolean }) {
 return (<section className="mt-4 space-y-2 rounded-lg border border-edge p-4 text-sm text-fg-muted">
                  <h4 className="font-medium text-fg">{zh ? '插件内容与范围' : 'Contents and access'}</h4>
                  <p>{zh ? '新增技能：' : 'Skills: '}{data.latestVersion.componentIndex?.skills.join(', ') || (zh ? '目录未提供清单' : 'Not listed in catalog')}</p>
                  <p>{zh ? '工具连接：' : 'Tool connections: '}{data.latestVersion.componentIndex?.mcpServers.map(item => `${item.name} (${item.transport})`).join(', ') || (zh ? '目录未提供清单' : 'Not listed in catalog')}</p>
                  <p>{zh ? '运行范围：' : 'Runtime scope: '}{data.latestVersion.riskTier === 'local-exec' ? (zh ? '包含本机代码执行，可能访问本机文件或网络' : 'Includes local code execution; may access local files or networks') : data.latestVersion.riskTier === 'network' ? (zh ? '包含网络服务调用；数据范围取决于账号授权' : 'Includes network service calls; data scope depends on authorization') : data.latestVersion.riskTier === 'content' ? (zh ? '目录标记为内容能力' : 'Catalog classifies this as content capabilities') : (zh ? '目录未声明，请查看说明与来源' : 'Not declared; review documentation and source')}</p>
                  <details className="text-xs"><summary className="w-fit cursor-pointer rounded focus-visible:outline-accent">{zh ? '授权与来源' : 'Authorization and source'}</summary><p className="mt-2 leading-5">{zh ? '发布者认证只验证来源，不授予操作权限。账号授权与依赖需另行设置。未列出权限不代表没有文件或外部访问。' : 'Publisher verification does not grant permissions. Accounts and dependencies require separate setup. Missing scope metadata does not mean no file or external access.'}</p></details>
                </section>);
}
