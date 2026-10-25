import type { ExtensionMarketplacePackageDetail } from './extension-marketplace-api';
export function PluginScopePreview({ data, zh }: { data: ExtensionMarketplacePackageDetail; zh: boolean }) {
 return (<section className="mt-4 space-y-2 rounded-lg border border-edge p-4 text-sm text-fg-muted">
                  <h4 className="font-medium text-fg">{zh ? '安装前了解范围' : 'Review the scope before installing'}</h4>
                  <p>{zh ? '新增技能：' : 'Skills: '}{data.latestVersion.componentIndex?.skills.join(', ') || (zh ? '目录未提供清单' : 'Not listed in catalog')}</p>
                  <p>{zh ? '工具连接：' : 'Tool connections: '}{data.latestVersion.componentIndex?.mcpServers.map(item => `${item.name} (${item.transport})`).join(', ') || (zh ? '目录未提供清单' : 'Not listed in catalog')}</p>
                  <p>{zh ? '运行范围：' : 'Runtime scope: '}{data.latestVersion.riskTier === 'local-exec' ? (zh ? '包含本机代码执行，可能访问本机文件或网络' : 'Includes local code execution; may access local files or networks') : data.latestVersion.riskTier === 'network' ? (zh ? '包含网络服务调用；数据范围取决于账号授权' : 'Includes network service calls; data scope depends on authorization') : data.latestVersion.riskTier === 'content' ? (zh ? '目录标记为内容能力' : 'Catalog classifies this as content capabilities') : (zh ? '目录未声明，请查看说明与来源' : 'Not declared; review documentation and source')}</p>
                  <p>{zh ? '适用于可使用此插件的智能体。发布者认证只验证来源，不代表具体权限已获批准。安装完成后，仍需检查账号授权、依赖和实际运行结果。未列出权限不代表没有文件或外部访问。' : 'Available to agents allowed to use this plugin. Publisher verification concerns provenance, not granted permissions. After installation, check account authorization, dependencies and actual execution. Missing scope metadata does not mean no file or external access.'}</p>
                </section>);
}
