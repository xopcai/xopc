# P3d 原生 Computer 入口：验证中

此记录不是完整通过报告，也不是 main 发布产物。macOS arm64 的独立 Native 验收副本使用隔离的 Cocoa 计数器；Gateway、配置、数据库、工作区与本机用户数据分开。网络走真实签名 HTTP/WSS，视觉模型为确定性本机服务；不代表物理 WAN、实际模型或其他平台已验收。

## 当前结果

- Main 入口单独授权，2 分钟有效；每次协议请求、目标应用、输入分别原生批准。只支持已有 OS 权限的 macOS；不继承本地 Computer 应用授权。
- 安装包内真实设备登记、取消/重新授权、Host 在线、应用发现、指定计数器目标授权及窗口观察已走通。
- 第 8 轮在按钮元素匹配上失败 `COMPUTER_ELEMENT_REF_REQUIRED`，未执行输入；继续保留为正确性失败，不能计作 Computer 输入 E2E 通过。
- 第 9 轮在 Mac 锁屏时失败。测试不解锁、不修改锁屏设置，不因此放宽时限。
- 已修复迟到的 Electron hide 通知误撤销已可见窗口的问题；真正隐藏、最小化、锁屏、撤销或切换仍使授权失效，恢复窗口不恢复旧批准。
- 测试模型现在保留首个错误并立即停止，防止重复工具调用掩盖根因。早期样本和失败目录继续保留。

## 产物与预算

第三版 Native 副本 1431 文件，SHA-256 `d203088128a5d337f39e4b6a0b9309763c2cfb68206af58e4dce3a5bb3f1e19d`。签名预览包尚未公证；不是最终 main 构建。

逐次调用 30 秒、停止 3 秒、授权 2 分钟及 S0 预算均未提高。原始 `reports/p3d-native-computer-*.json`、`/tmp/xopc-p3d-native-computer-*.log` 和失败夹具留在本机；提交的 attempts.json 仅包含去除凭据、截图和用户数据的状态摘要。

当前源码回归：98 文件通过、1 文件条件跳过；960 项通过、15 项条件跳过，日志 `/tmp/xopc-p3d-current-regression-2.log`。根目录及 Electron 类型检查通过，日志 `/tmp/xopc-p3d-current-typecheck-1.log`。集合有重叠，不与历史次数相加。

下一步：诊断隔离窗口的 AX 元素匹配，完成一次真实输入及停止/丢结果核实原生验收，然后重跑新版安装包本地新建、旧 Gateway 复用和远端聊天回归。Browser、磁盘限制/卷管理、P4 和最终 main 交付仍待完成。

连接管理器专项通过真实认证 HTTP/WSS：缺失 remoteComputerVersion 的旧 Gateway 在本机批准和驱动创建前拒绝，取消批准不扩 scope；成功授权不携带 workspaceId，实际发现完成后切换 epoch 会停止私有驱动并撤销精确 grant，连接配置保留。日志 `/tmp/xopc-p3d-computer-manager-e2e-2.log`。首轮夹具未将随机端口 origin 加入明确 CORS 列表而被拒绝（日志 `-1.log`、失败目录保留）；仅补齐夹具实际监听 origin，未放宽生产校验。

## 批准前断线恢复修复

已确认并修复：Computer 请求尚未进入执行 journal 时，服务器 unknown 记录缺少可用的人工核实路径。可信连接页先停止执行器、获得固定本机根的排他 lease；只对精确远端 Computer descriptor/revision 且无 workspace、无 journal 记录的请求，允许原生人工核实并持久保存 unknown tombstone。实际私有驱动创建必须在 journal.start 后，已有记录的请求继续要求独立停止证据。不会把旧结果改成成功、重做旧输入或自动恢复批准。

18项专项通过（日志 `/tmp/xopc-p3d-computer-no-start-review-5.log`），包括真实认证HTTP、人工取消、核实回执丢失、旧意图不重放、错误 revision/workspace 拒绝和已有 Computer 记录缺失停止证据拒绝。早期 `-1/-2` 暴露 journal 的另一道工具白名单未补齐，`-4` 为夹具误带 workspace，均保留。生产修复提交 `462f2b547`。

包含该修复后的当前相关回归为968项通过、15项条件跳过、101文件通过、1文件跳过，日志 `/tmp/xopc-p3d-current-regression-3.log`；全类型检查 `/tmp/xopc-p3d-current-typecheck-3.log` 通过。第四版安装包完成374资源/669构建文件布局门禁，正在执行真实安装包本地和远端回归；仍非最终main构建。

第四版安装包本地新建及旧v266 Gateway复用回归通过，含真实菜单切换、聊天/流式事件、文件边界、PTY、内置浏览器、拥有进程重启与外部进程保护。`reports/p3d-computer-installed-local-4.json` 及 `/tmp/xopc-p3d-computer-installed-local-4.log`。安装副本1431文件摘要 `7ec4492bb03830106b9c1b27b8daf8d041cdfcc8bba7865241a665c4983311db`；Native副本摘要 `841bd10dab0e1cdfda6633491faf3afc392a53606b7005d75d27c01152be48ae`，仅允许身份/签名差异。

第四版远端聊天与恢复回归第5轮通过：实际start/append/history、停止、网络/事件缺口恢复不重提、进程/worker崩溃保留unknown、丢回执查询、Gateway草稿隔离、加密恢复提示、无本机Agent/会话DB/默认Host及原本地重启均通过。首轮 `p3d-computer-installed-remote-4.json` 因旧测试标题等待失败，保留原30秒预算；仅在测试中精确兼容旧“连接预览”与当前“连接管理”标题，第5轮使用同一不可变安装包。见 installed.json，原始日志 `/tmp/xopc-p3d-computer-installed-remote-5.log`。TLS变体继续验证；真实Computer输入仍未通过。

TLS变体：第1轮将夹具自签证书作为正向信任样本连接时返回 `GATEWAY_TLS_FAILED`，失败保留；当前已安装包/worker信任是否接收该临时CA尚未核实，不能计作正向TLS通过。独立 `--tls --tls-rejection` 第1轮通过：不可信证书在任何携带凭据的HTTP请求前被拒绝，不登记Host、不创建本机数据库/工作区。TLS校验、签名包fuses和系统证书信任未放宽。见 tls.json。新版有效公共证书的正向验收仍需后续补齐；历史S4公共HTTPS结果不追溯更改。

## 第14轮原生整轮通过

2026-11-01第14轮，同一第五版Native包完成实际设备登记、全局取消/重授权、逐次请求/目标/输入批准、真实AX观察、计数器一次点击（私有fixture-state.json计数为1）、签名HTTP/WSS持久回执以及释放控制。`reports/p3d-native-computer-14.json`，所有Computer操作为已知持久结果且executionStopped为true。没有使用真实用户应用、全局脚本批准或主进程调试钩子；视觉模型仍为本机合成推理服务，不等同实际视觉模型/WAN/平台矩阵已通过。

修复/夹具说明：
- SDK返回的窗口元素可用，但应用其他树被截断，ui.resolve因此正确拒绝“完整树唯一匹配”。夹具改为使用已观察到的精确AX按钮ref；生产对不完整树的唯一匹配校验未放宽。
- 已绑定会话的release仅停止、不读取或输入；Main不再为释放控制弹批准框，保留原5秒释放预算。读取、目标与输入继续分别批准。第12轮释放超时失败保留。
- 夹具使用真实stopped收尾状态，完成后继续返回终态，不重新寻找工具。第13轮实际单击/释放完成但模型收尾失败，证据保留，未计作完整通过。
- 第10轮目标阶段超时、第11轮取消预期不符和此前所有失败继续保留；没有增加30秒调用、3秒停止或2分钟授权预算。

第五版Native副本1431文件，摘要`bf1e192b442f2e37d628953d0197341af1cf9a6c9a4d21097b725da51e1be065`。实际安装副本本地新建/旧v266复用及远端聊天回归通过（reports local-5 / remote-6，见installed.json）。963项相关回归通过、15项条件跳过（集合重叠），Electron类型检查通过；日志`/tmp/xopc-p3d-computer-release-regression-1.log`、`/tmp/xopc-p3d-computer-release-typecheck-1.log`。Main之外的Gateway/server代码与前版相同。生产释放修复提交`9b428243d`。

仍需完成Computer原生输入取消/丢结果人工核实故障矩阵、专用Browser、P4和最终main构建；不能用正常整轮通过替代这些验收。
