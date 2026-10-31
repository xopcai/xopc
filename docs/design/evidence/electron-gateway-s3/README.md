# S3 验收与失败证据（2026-10-31）

基于 main `3f86a8af2`，最终产品源码 `e6298c4fc`。范围见[冻结契约](../../electron-gateway-s3-contract.md)与[实施记录](../../electron-gateway-s3-report.md)。本目录保存原始失败、正式复测、产物指纹、环境和命令；原 S0/S1、性能排查、S2 证据不覆盖。

## 基线与性能口径

- [原冻结 S0](../electron-gateway-p2a1-s0-s1/s0-local-baseline.json)是唯一预算来源，不以本次 main 或其他较宽数据替代。
- [首轮 main 复现](./s3-main-baseline.json)与类型检查短暂重叠，**不作为正式基线**；即使结果通过也不采纳。保留原始 JSON/日志及原因。
- [独立重跑 main](./s3-main-baseline-isolated.json)使用同一构建产物，无并行构建/测试，按原预算8/8通过。
- 最终预算与命令见 `validation.json`：每轮新启动/复用各30次，每模式每API129个样本，`first-launch-heavy-v1`、原阈值与原采样脚本不变。正式采样无诊断、无额外计时前等待；运行前后产物指纹一致。

## 最终功能与构建

最终相关940项 / 113文件、完整类型检查、lint（0 errors / 5个既有 warnings）、dependency-cruiser（0 violations）、CLI启动导入检查和Node/Web/Electron构建通过。dependency-cruiser不扫描全部Electron，另以源码调用链、单测和真实Electron验证补充。

最终10组报告（`s3-release-*.json`）包括：聊天SSH（含45秒原预算的WS半开）/HTTPS-WSS、Shell SSH/HTTPS、证书拒绝、主机名拒绝、清理失败隔离、配置预览、原生safeStorage、本地新启动/复用完整功能。聊天验证两台独立真实Gateway，包含服务器停止确认、协议gap、丢响应、重启/worker SIGKILL后只查询receipt、A/B草稿/历史/待核实隔离；文本提交次数不增加。唯一确定化的是推理SSE fixture。

图片为开发UI核对截图，不代表安装包或远端服务器部署验收。显式回本地观察生产代码的relaunch参数，再由测试监督器按相同参数启动原main，不能当作OS原生relaunch/升级验收。缺失S3资产故障副本若有报告，仍共享开发依赖、Gateway/Web/SQL及辅助资源映射，不是完整安装包。

## 保留的失败与修订原因

| 原始记录 | 说明 |
| --- | --- |
| `xopc-s3-foundation-typecheck.log`、`-2.log` | 事件注册参数错误；必需stream回调/UUID默认参数类型不匹配，修复后通过 |
| `xopc-s3-foundation-tests-1.log` | 每次代理前验证身份后，discovery重定向变为硬错误409锁定；拆分旧502断言，未放宽边界 |
| [首次聊天E2E](./s3-remote-chat-first.json) | fixture向严格配置文件写入已退役agents字段；改通过真实Gateway管理API准备模型/Agent |
| [第二次](./s3-remote-chat-second.json) | fixture在配置页导航完成前执行evaluate；补真实页面就绪等待 |
| [第三次](./s3-remote-chat-third.json) | 实际产品重复气泡：历史缺流messageId；改为服务器历史优先，保留严格单气泡断言 |
| [第四次](./s3-remote-chat-fourth.json) | fixture evaluate不支持动态import；使用主进程内置模块接口 |
| [第五次](./s3-remote-chat-fifth.json) | Node构建清理旧Web产物导致本地UI缺失；恢复正确Node→Web→Electron构建顺序 |
| [第六次](./s3-remote-chat-sixth.json) | 本地browser-session实际字段为conversationId，fixture误断言authenticated；核对真实认证响应后修正 |
| [重启/崩溃专项初次](./s3-chat-complete-ssh.json) | utility metrics在当前平台使用name字段；兼容name/serviceName，仍只定位本测试App拥有的Utility |
| [预览初次](./s3-final-preview.json)、[重跑](./s3-final-preview-retry.json) | 测试仍断言旧S2文案及旧错误响应；同步S3文案与无凭据snapshot，继续验证epoch和零联网 |
| `xopc-s3-preview-focused-tests.log` | 错误project过滤导致没有执行任何测试，不作通过证据；随后正确运行相关测试 |
| `xopc-s3-ambiguous-stream-before.log` | 实际产品回归：gap后以相同前缀猜测消息身份会改错回答；改用可信ID或持久历史，不猜测 |

同名日志记录完整错误/快照，未以最后通过覆盖。所有凭据、会话与文件均是隔离fixture合成数据；不包含用户真实长期token。未确认输入的本机记录是恢复提示，不是离线队列；超时/404不证明未执行，不自动重放。

## 验收范围

仅macOS arm64开发Electron。TLS终止层、Gateway和推理fixture位于同一机器的独立测试进程；没有外部SSH登录或物理远端主机。S4安装包/独立服务器/跨平台、S5长期故障/24小时、升级回退仍未验收。没有远端Host或本机能力接入，不宣称完整P2a-1发布或所有环境与本地同等稳定。

正式两轮性能结果均 **8/8通过**，各60次启动，见[复测1](./s3-release-budget-1.json)、[复测2](./s3-release-budget-2.json)和[汇总/完整命令](./validation.json)。[资产缺失本地功能](./s3-missing-assets-local-functional.json)与[删除清单](./s3-missing-assets-manifest.json)也通过；[初次准备失败](./s3-missing-assets-setup-failed.json)是chunk嵌套路径假设错误，未启动功能测试，修正后重跑，无产品/预算修改。复测时所有命令须使用新输出路径，不能覆盖本目录。
