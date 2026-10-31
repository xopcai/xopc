# D3a 显式授权的设备状态 Host

功能优先推进，不等待S5的24小时长测。只开放 `desktop.device.get_state`；截图、文件、剪贴板、命令和控制尚未开放，完整P2a-2未验收。

## 交付

- 独立 `desktop.observe.state` scope，配对默认仍只有原有两项scope。原生逐项确认与服务端授权同时成立才启动独立Host；本机停止立即断开Host并清除本机批准，再核实服务器撤销。重启/切换不恢复本机批准。
- 设备登记和Realtime hello同时绑定deviceId、公钥及唯一允许的工具名称。配对设备不能借owner ticket绕过独立设备授权，已撤销设备同样不能；旧本地owner Host走原路径。
- Gateway确认和每个工具帧的Ed25519证明绑定Gateway、设备、clientId、connectionInstanceId和递增序号。Host在交给Endpoint控制器前验证；无签名、串连接、重放、过期或被修改的帧不会执行工具。独立Host失败不关闭聊天。
- 观察授权版本持久化为v264的 `desktop_observation_grants`：原生确认前读revision，提交时compare-and-set；撤销即使先于授权到达也递增revision。权限JSON与版本同事务提交，存储失败回滚。旧程序拒绝v264，避免读取不认识的新scope；v202起完整升级链保留。
- 聊天窗口可打开本机设置而不关闭聊天。用户明确勾选本机来源后，main将准确的活动Host claim绑定到当前Shell worker；不同设备/旧claim被代理拒绝。Host离线时保留草稿且不发送，不自动改发服务器；取消勾选后正常发送到服务器。

## 验证

正式DMG安装副本：`f507f2a2eea48b568c713c54e44bceb59db9540c38cd27f73a1e3dbf89db56f4`，1424文件。Developer ID严格签名、369必需资源、662构建文件对应关系、58.25MiB运行依赖通过；未配置macOS公证，不作为公开发布验收。

- 97项Electron连接回归、116项Endpoint/Realtime单元回归、43项Realtime专项复测、70项路由测试、140项schema/完整升级链与认证路由测试、3项授权持久化/事务回滚测试、根/Electron类型检查通过；契约结果见 `contract-tests-1.log`。
- 真实HTTP、lazy route、签名请求证明和WebSocket E2E：实际只读调用；无授权、串设备、公钥替换、伪造只读工具、owner ticket绕过、注入无签名调用和服务端撤销均拒绝；原生确认期间发生撤销时旧revision不能建立Host。旧Endpoint正常完成调用和清理的E2E同时通过。
- 正式包内Gateway认证E2E通过，额外验证owner ticket不能绕过独立设备授权/撤销；Node监督器加密注入不冒充OS安全存储。
- 正式包本地spawn/reuse、聊天/Cookie/WS、文件边界、PTY、浏览器、进程所有权/重启/退出隔离通过。复用旧schema263及262 Gateway分别通过，数据库版本前后不变。远端聊天与半开连接/进程故障/未知输入/版本/身份/认证拒绝回归通过；短场景不冒充持续运行结果。
- 原生完整交互第4轮通过：CUA实际点击身份登记取消/批准、设备状态授权取消/批准、重新登记取消/批准。Agent通过 `tool_search` 找到状态工具，经过真实签名Endpoint连接读取Electron的实际平台/版本/语言/时区；模型收到结果，服务器成功审计恰好1次。停止后无新POST、保留草稿，取消勾选后服务器消息不再声明设备工具。

原生交互副本仅将bundle id改为 `ai.xopc.desktop-observation.acceptance` 以定位正确测试窗口，并用相同Developer ID/entitlements签名。与正式包仅Info.plist和包含签名的主可执行文件不同；asar、preload、Gateway、SQL和原生资源相同，详见 `native-bundle-differences.json`。不混称正式发布包标识；正式包单独执行上述本地/远端/认证测试。

## 失败及未验收项

- 原生第1轮安全存储触发原有15秒超时保护，进程拒绝继续写入；失败状态目录保留。新进程第2–4轮不再复现，没有放宽超时或声称已找到性能根因，冷启动安全存储耗时仍需后续专项核实。
- 第2轮预期取消而实际返回确认，原生结果和失败保留。第3轮完整功能检查通过，但模型fixture错误要求所有请求均声明工具；包含一个无工具请求时总体仍判失败。第4轮只对声明工具的请求驱动发现流程，并仍强制实际状态读取及成功审计；记录显示真实聊天3次工具请求、另1次无工具请求及1次服务器消息。没有删除正向调用断言或放宽预算。
- 首轮类型检查发现过滤数组推断后无法加入新scope，修复显式类型，保留日志。所有原始JSON/日志有清单摘要；失败目录没有删除。
- 原预算摘要仍为 `e752bb4b97f54e4713d8ecc8b6f8cd302d3e80d044099b0397dfe113d0f45746`。性能、S5完整24小时、只读Host自己的长测、物理WAN、真实休眠唤醒、其他操作系统/架构和完整升级回退矩阵未在本批记作通过。S5原有长测仍使用独立不可变安装包并行运行。
- 后续继续D3b截图及D4验证；身份文件在删除profile后的退役/清理、冷安全存储重现和授权持久化备份回退演练纳入D4，不以性能延期删除正确性待办。
