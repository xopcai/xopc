# Phone Use 本地版本交付记录

后续版本：聊天实时视频与持续触控已经落地，见 [V2 视频实现与验收](phone-use-video-v2.md)。以下保留首版本地 ADB 与截图阶段的验收记录。

日期：2026-10-23。对应[调研方案](./phone-use-architecture-research.md)，当前交付本地 ADB 预览版本。

## 已实现

- `phone_use` Agent 工具与手册，共用 PhoneRuntime，支持发现、打开、观察、小目标执行、单步、状态、暂停、恢复、停止及释放。
- Agent catalog 的独立 `models.phoneUse`，全局默认与 Agent 覆盖，禁止自动 fallback。
- 模型目录 `phoneUse.profile`，AutoGLM 字面量动作解析、通用结构化动作适配，以及只在本地模拟器启用的固定 Mock。
- 手机设置页直接选择 Provider、配置 API Key 与手机模型，沿用共享凭据接口，支持自定义 OpenAI 兼容服务；模型连接测试使用合成图，不读取设备隐私画面。
- SQLite DurableState 保存小型设备配置、独占租约及最多 50 份无截图的元数据报告；未修改数据库 schema 版本。
- 本地 ADB 设备发现、注册、默认选择、改名、应用范围与 Agent 工具权限、禁用、删除注册和截图预览。
- 真实 PNG 截图、前台应用识别、原生 UI 观察、输入焦点检查、中文输入法恢复、动作前新观察及陈旧动作丢弃。
- 鉴权 API、懒加载匹配及邻近负向映射测试；管理接口限制为 Gateway owner/admin。
- 设置导航「手机控制」，模型管理、Agent 模型覆盖、设备弹窗、测试卡及暂停/停止等操作。

## 实测结果

测试使用隔离临时 Gateway 状态；未修改用户生产 xopc 配置，也未保存密钥值。测试模拟器为 `XOPC_Android_Test_API_35`，ADB serial 为 `emulator-5554`。

1. **模拟模型 + 真实模拟器 + 真实认证 Gateway 路由**：启动系统设置，滚动列表并点击关于手机，通过原生 UI 证据验证完成，鉴权截图预览通过。
2. **真实 AutoGLM**：合成图协议/按钮定位通过；从关于手机返回设置列表，实际 1 次模型请求、1 次 Back 动作，匹配 `System` 原生文字，验证通过。
3. **预算边界**：更大的返回并滚动任务在 4 步预算下未完成，返回 `action_limit`、`verified=false`；此结果保留在证据中，不能据小任务通过推断任意任务可靠。
4. **浏览器**：通过正式浏览器 Cookie session 交换鉴权，完成设备改名及保存；检查桌面、375px 窄屏及深色预览，未出现页面 JavaScript 错误。
5. **自动化检查**：17 个相关测试文件、133 项测试通过；完整 `pnpm run build`（Node、声明及 Web）通过；新增后端和前端文件的定向 ESLint 检查通过。

测试还覆盖 Agent 工具封装、陈旧坐标丢弃、未知执行结果不重试、空 UI 不盲操作，以及 Android CLI 输出的系统通知隔离与密码字段过滤。

验证中发现：部分 Settings 页面持续产生布局事件，普通 `uiautomator dump` 不能稳定取得文本。实现优先使用已安装的官方 Android CLI `layout --no-idle --flat`，并对启动期间的空布局做有界重试；无法观察时明确暂停。不是把空观察当成功。

以上为该阶段验收摘要；逐次运行 JSON 与临时截图不纳入仓库，生产运行也不会以此方式保存截图。

同日通过真实 Gateway 聊天入口，由 main 调用 discover / open / run / close，实际使用 AutoGLM 发起 7 次模型请求、执行 6 个动作，读取原生 UI 中的 Android 15 后关闭会话。该次 Agent 使用中文 expectText，而模拟器界面为英文，因此自动完成条件未通过；版本由原生 UI 事实独立确认，不能将模型完成等同于自动验证通过。相关 17 项测试、类型检查、ESLint 和差异检查通过。

## 使用与复验

用户入口及环境变量说明见[中文使用说明](../../zh/phone-use.md)。开发验证脚本：`pnpm exec tsx scripts/verify-phone-use.mts`。默认不产生真实模型调用；带 `XOPC_PHONE_REAL_MODEL=1` 才会调用 AutoGLM。

## 当前边界

- 只运行 Gateway 本机的 ADB；未实现阿里云/腾讯云账号管理、自动建隧道、远程 Runner、HDC、iOS 或实时视频。
- USB 与已有 ADB 连接走同一驱动，但本次实测覆盖本地 Android 模拟器，不能替代真机和云手机验收。
- Mock 只支持明确的设置测试场景，不是通用手机模型。
- 多设备租约仅在同一 SQLite 状态内协调；不同 Gateway 状态目录不互相仲裁。
- UI 完成条件不等于业务后端成功；用户接管、状态竞态、敏感行为和第三方 App 兼容性仍需监督及进一步评测。
- 中文输入路径已实现，但本轮未安装 ADB Keyboard 实测 Unicode 输入；不能宣称该能力已完成设备验收。


## 2026-10-23：聊天实时画面与人工接管

已实现 conversation-scoped phone 工作区标签、宽屏展开 / 窄屏入口、带时间的共享截图刷新、只读观看、人工控制与显式交还。输入经控制 epoch、客户端身份、应用白名单、帧新鲜度 / 几何 / UI 布局检查及串行 I/O 仲裁。重复 operationId 不重放输入；控制心跳断开保持暂停；暂停时间不消耗 90 秒活跃操作预算，仍受会话总时长限制。

真实验证包含两条路径：main 的 run 在人工滑动期间保持等待、交还后由 AutoGLM 继续并读取 Android 15；以及 main 先 pause 并结束回复、用户人工点击后交还，服务端幂等唤起 main 重新 observe 并关闭会话。仅查看点击未注入输入，接管期间模型请求与 Agent 输入均未增长。

106 项相关测试、根 / Web 类型检查、ESLint、完整构建通过。该阶段为按需截图刷新，不是连续视频；云手机与隐私遮屏切换未在此阶段交付。

## 2026-10-24：手机依赖安装验收

macOS arm64 隔离 Gateway 验证 Platform Tools 37.0.1 与 scrcpy server 3.3.3：未认证状态请求返回 401，认证请求经过真实懒加载路由；检查复用已有 SDK 且不自动下载。手机设置页完成官方离线包安装、已有 ADB 路径保存与 scrcpy 文件导入；错误 hash 被拒绝且不破坏有效版本，在线 scrcpy 修复通过官方地址下载并校验。运行工具页共享同一卡片，中文布局及 CLI `runtime status --phone --json` 就绪状态通过。

162 项相关回归通过；最终修改的 UI 测试另有 12 项通过，包含仅云手机且本机缺少 ADB 的场景。根 / Web 类型检查、Web 构建、定向 ESLint 与差异检查通过。本轮未操作手机或调用模型；Windows/Linux 仅核对官方包 hash，未运行其可执行文件，也未进行跨平台 E2E 或 Electron 打包验收。
