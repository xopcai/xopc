# P3c-2 Docker命令接线与原生验证

2026-11-01。用户明确接受本机Docker隔离后端。本批完成独立能力协商、设备执行授权、Native逐次完整argv确认、签名Endpoint调用、可靠执行记录、未知结果核实与保留卷重新授权。当前仅macOS/本机Docker，无网络/用户目录挂载/主机凭据；服务器默认命令与现有本地模式保持原路径。

## 结果与候选

- 第3版安装包：`/tmp/xopc-p3c-delivery-3/installed/xopc.app`，1431文件，指纹`9e8cd5e202785ef604068897e9da3953c150eb88112fb5f8cba306acad5d540b`。原生副本仅修改Info.plist和主MachO的独立测试身份并重新签名，指纹`b8599407e9ddf1b129efd1c3a7d6d8e6e04c93663287b4ea4d1bb3076e9d9ac9`。包内依赖、374项UI/Shell/Gateway/SQL资源及669项运行时字节检查通过。
- [原生第4轮](./native-4.json)完整通过：取消Docker授权不创建卷/记录；取消命令有对应USER_DENIED审计；批准后真实写入；同卷新授权可读原文件；非零退出仍携带输出；真实持久化签名成功帧被丢弃后服务器unknown保持；人工核实取消/批准均不重放；新授权/新意图读取原数据，丢失操作的追加计数保持一次。设置窗口与聊天均由真实OS焦点切换，未伪造Native批准。
- [本地安装包](./installed-local-3.json)新启动、聊天、Cookie/Realtime、原生文件/PTY/内置浏览器IPC、自己持有进程重启通过；复用旧schema266 Gateway不升级、不停止其进程，退出后旧Gateway继续运行。
- [远端聊天安装包](./installed-remote-3.json)恢复、丢回执、A/B隔离、重启/worker崩溃未知输入、显式返回本地通过。本轮为同机隔离服务器及确定性推理，不冒充独立主机/WAN或实际模型验收。
- `/tmp/xopc-p3c-wire-tests-5.log`：199项/28文件通过；`/tmp/xopc-p3c-retained-tests-1.log`：18项/5文件通过，包含真实Docker/Gateway/独立设备/Agent Provider调用及保留数据加密隔离。集合重叠，不相加。完整类型检查16轮通过。

## 失败保留与修复

- [第1轮](./native-1.json)：锁屏导致原焦点预算超时，未创建测试卷。原报告及`/tmp/xopc-p3c-native-container-1.log`保留。
- [第2轮](./native-2.json)：取消分支收到非预期返回，未证实该次实际点击为取消，不能判为通过。原临时状态及日志保留。
- [第3轮](./native-3.json)：取消/批准/读取已通过，NONZERO在等待批准时授权到期断连，审计为OUTCOME_UNKNOWN。保留原私有卷和状态，不删除journal/unknown以绕过。第4轮改为每两条命令后独立核实停止并为同卷请求全新授权，仍为两分钟，不延长授权或调用预算。
- 实际Gateway E2E首次暴露下发前错误参数/错误workspace被错误投影为未知副作用；仅这些可证实尚未下发的拒绝现返回confirmedNoEffect。执行中断连或无有效回执继续unknown。`/tmp/xopc-p3c-gateway-e2e-1.log`保留，后续通过。
- PTY Engine初次类型检查不支持RequestOptions.highWaterMark，已移除，使用Node默认有界socket背压；`/tmp/xopc-p3c-typecheck-11.log`保留，不声称自行设置了该socket缓冲区。

## 继续待办

保留工作区只存数据身份，不保存授权。最多20项、完整Gateway身份隔离；缺卷报错且不自动重建。总磁盘配额、显式卷管理/文件交换仍待补齐，现有限额不能当作总磁盘上限。

PTY字节流与独立根操作生命周期核心已实现但尚未暴露。`/tmp/xopc-p3c-terminal-worker-2.log`相关14项通过：真实TTY/有序背压ACK/持久输入去重、元数据Owner SIGKILL不重放、根操作打开后保持running、撤销后独立销毁、创建中取消与删除失败重试。该生命周期及资源中允许terminal.open的扩展在第3版构建后加入，不能以该包宣称PTY已打包或验收；Gateway/Host/Agent/UI专用Broker继续实施。

S5旧候选长测继续独立运行，不是本批Host/PTY长测。性能失败保持待办；S0原预算文件SHA256仍为`e752bb4b97f54e4713d8ecc8b6f8cd302d3e80d044099b0397dfe113d0f45746`。尚未push或合入main；最终完成全部功能后线性合并并从main重新构建。

## PTY Main内部控制边界补充

新增尚未注册IPC/网络入口的`DesktopTerminalBroker`。完整绑定Gateway、设备、workspace、授权revision、session/generation/connectionInstance；每次远端stdin均调用本机确认钩子，输入不能携带`source=local-user`绕过。打开仅返回running/未停止；根journal和专用容器继续存活。停止使用原3秒预算并核实资源和根操作持久终态，失败阻断输入与接管。关闭后的broker不恢复，须建立新代次。

复查修复等待打开批准时的迟到启动：停止即永久关闭当前broker并取消待批准请求，即使确认回调忽略signal后返回true也不会创建执行器。真实Docker测试已通过该broker和共享supervisor/journal、输入ledger、字节流及容器删除，仍是源代码夹具而非Native/网络接线验收。初次接线将带额外身份字段的scope传给strict resize binding导致拒绝，失败保留于`/tmp/xopc-p3c-terminal-broker-live-1.log`；修复只向worker传递精确binding。第2轮实际Docker通过；最终`/tmp/xopc-p3c-terminal-broker-live-3.log`14项/3文件通过，包含离线停止、迟到批准、3秒停止上限、未确认删除不可接管、实际PTY根操作和输入去重。Electron类型检查21轮通过。最新完整相关回归6轮为201项/29文件通过，未修改预算。
