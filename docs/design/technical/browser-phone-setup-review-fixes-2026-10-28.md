# Browser / Phone 对话配置审查修复

日期：2026-10-28。范围：修复既有 Browser Use、Phone Use 配置闭环，为后续 Computer Use 配置引导提供基础。

## 问题与实现

| 审查问题 | 修复后的行为 | 验收方式 |
| --- | --- | --- |
| Phone 异步检查期间取消，检查结束后仍可能写配置 | 写操作先占用进度版本，异步检查后再次校验会话、版本与宿主授权；安装下载可中止，落盘前再次检查。取消立即作废请求，等待已经开始的提交结束，不复活状态 | 延迟检查、并行写入、授权撤销、下载取消、配置写队列回归 |
| 原对话重置没有关闭独立验收 owner | Browser / Phone 授权绑定当前 transcript；重置先作废所有相关 Agent 的配置请求，关闭独立测试会话并确认释放，再归档旧 transcript。无法确认释放则返回失败，不显示重置成功 | 真实 SQLite transcript 替换、独立 owner 释放、清理失败阻断重置 |
| 人工步骤仍依赖完整设置页及用户再次回复 | 宿主返回 `interactionPath`；普通检查、安装和配置继续由对话完成，仅人工步骤打开固定尺寸弹窗。Browser 明确选择 Chrome 并授权独立测试；Phone 复用安全连接表单和兼容模型选择 | 弹窗保存、关闭、失效、取消、目标选择与原对话续跑 |
| 准备完成被当作完整 E2E 通过 | Phone 脚本要求 `completed` 且五项宿主检查全部通过；缺少兼容模型或外部条件时保存阻塞证据并以非零退出。Browser 新入口验证当前对话流程及生产连接链路 | 真实聊天模型、生产扩展 / Native Messaging / Realtime、真实云手机动作模型 |

## 交互与权限边界

- 通过 `/configuration/:scene/:setupId` 打开小弹窗或移动端底部 sheet；使用现有 Gateway owner 身份验证和产品表单。密钥不进入自动续跑消息。
- Phone 模型保存调用当前 setup 所属 Agent 的模型配置，不改全局模型；API 检查 setup、原对话、当前版本和兼容模型。未认证、串用另一对话及重复旧版本写入均被拒绝。
- 保存或显式点击继续后，先从宿主重新检查配置，再自动发送无密钥的继续指令，回到同一 conversation。Browser 按钮明确授权独立页读取、点击和示例输入；关闭弹窗不自动开始验收。
- 这次续跑由用户保存或确认触发。原生扩展加载、系统权限及 USB 调试授权仍由用户完成，不能声称全程无人参与。
- 取消不回滚已提交的配置。它阻止后续提交，等待正在提交的操作收敛，并释放验收控制。旧的未绑定 transcript 的真实会话授权按过期处理，可清理后重新开始；无需数据库迁移。

## 自动验收

真实 E2E 使用隔离 Gateway、SQLite、工作区与对话。Browser 还隔离 HOME 和 Chromium profile；Phone 复用已配置的专用阿里云测试手机与现有凭据，未修改日常全局配置。

1. Browser：在真实 App 聊天输入配置需求，真实模型渐进读取 Skill 并准备扩展和 Native Host；通过生产 Native Messaging、配对和 Realtime 接入。人工必需步骤弹窗选择准确 Chrome 后，自动回到原聊天，模型在独立页完成读取、点击、输入，关闭测试并读取宿主验收报告。脚本严格检查无工具错误、无残留 debugger 和测试页。
2. Phone：真实聊天模型 `xopc-cloud/openai-codex/gpt-5.6-sol` 配置兼容动作模型 `xopc-cloud/phone-doubao`，绑定专用云手机并启动有界设置页测试。真实动作模型打开 Android 版本详情，读取原生界面后关闭并释放；`configured/read/operated/verified/released` 全部为 true。
3. 自动回归覆盖取消竞态、重置顺序、配置写保护、安装中止、owner API 认证和作用域，以及弹窗返回原聊天。原始 transcript、凭据、设备身份及连接信息仅在被忽略的私有验收目录，公共证据仅保存脱敏结果。

最终 Browser 验收直接点击模型回复中的真实配置链接，未用测试脚本拼接地址代替点击。首次补验发现模型擅加 `http://localhost`，已明确要求 Skill 和工具手册逐字保留宿主路径，并将此入口纳入 E2E 硬断言。

相关自动回归共 11 个文件、125 项通过；根项目与 Electron 类型检查、Web 类型检查和生产构建、验收脚本类型检查、修改源文件 ESLint 以及 `git diff --check` 通过。生产构建仍有既有的大 chunk 提示。

Browser 通过 Chromium 启动参数加载扩展，生产生成的 Native Host manifest 放入隔离 profile 对应目录；未把真实用户点击 Chrome“加载已解压”文件选择器、Gatekeeper/TCC 或真实 USB RSA 弹窗算作本轮自动通过。云手机已完成真实动作验收；本机 USB 手机首次连接仍需单独设备验收。

可复跑入口：

```sh
pnpm -C web run build
XOPC_BROWSER_PRODUCTION_EVIDENCE=.xopc-evals/setup-review-fix/browser-chat-link-final pnpm exec tsx scripts/verify-browser-setup-conversation.mts
XOPC_PHONE_REAL_MODEL=1 XOPC_SETUP_LIVE_SCENE=phone XOPC_PHONE_SETUP_MODEL=xopc-cloud/phone-doubao pnpm exec tsx scripts/verify-conversational-setup-live.mts
```

Phone 脚本使用专用测试手机及本机现有安全凭据；缺少条件时应读阻塞报告，不能人为改成通过。

详细结果见[脱敏验收证据](evidence/browser-phone-setup-review-fixes-2026-10-28.json)。2026-10-24 的阻塞摘要见下节，2026-10-25 的报告保留为历史记录，不能用旧报告推断当前模型目录或当前验收状态。本轮尚未增加 Computer Use 配置引导。

## 合并保留的早期额度阻塞记录

2026-10-24 的 Phone 配置验收曾被旧动作模型 `xopc-cloud/phone` 的 HTTP 429 `free_quota_exhausted` 阻塞；83 次配置对话模型请求均为 HTTP 200。两种设备当时均为 configured/read/released=true、operated/verified=false，不能将读屏或宿主打开设置页算作模型操作成功。原记录已于 2026-10-29 合并到此处；脱敏数据（历史产物已移入 Git 历史）和额度提示截图（历史产物已移入 Git 历史）保留。

该轮验证了本地模拟器与既有阿里云测试设备配置、浏览器确认后续接、Gateway 重启后保留尝试且不重放操作、失败后释放并可被独立会话重新取得控制。修复包括 scrcpy 不阻挡基础截图/导航验收、原对话刷新保留设备、标准关于手机入口、原生树 idle 失败时压缩树回退，以及额度错误不要求重装 ADB/重新授权、不立即自动重试。186 项相关回归通过；未验真实 USB RSA、云手机购买或私钥轮换。后续真实动作验收结果以上方 2026-10-28 五项检查为准；这次清理没有重新执行外部调用。

历史产物保留说明（2026-10-29）：本页所涉已清理截图、逐次 JSON 与源码快照可从 Git 历史恢复；上文数字和失败限制保留为历史观测，不代表本次重新验收。复跑输出应指定临时目录；旧路径仅记录当次运行位置。
