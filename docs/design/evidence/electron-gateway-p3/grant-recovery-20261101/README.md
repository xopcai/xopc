# 授权前持久记录与崩溃恢复（2026-11-01）

新增Main固定状态目录中的加密grant ledger；原生批准后、POST设备执行授权之前fsync保存精确Gateway/设备/grant/revision/lease代次/父进程。正常停止必须先持久化签名停止证明，才关闭原ledger。

恢复取得原固定排他lease，核实旧父进程不存在、逐一核实原代次的所有操作资源（包括成功后仍空闲的Computer/Browser），未知记录仅增加停止确认，不改变unknown或跳过人工核实。无操作的旧授权也可核实退出；已持久化证明复用原stopId，不重新创建证明。设备重新登记前同样先完成本机恢复，防止覆盖签名身份。恢复本身不请求服务器、不执行旧操作、不开新工具，补交仍使用独立签名接口。

纯聊天在没有ledger时不创建executor数据库、不访问设备安全存储；原本地直连入口不接入该路径。

实际Node子进程持有lease、保存ledger和running记录，Gateway经真实认证HTTP建立执行授权；SIGKILL后恢复验证通过Computer和Browser两种授权，包括旧owner活着时拒绝、资源停止未确认时拒绝、unknown保留、重复恢复复用证明及无操作授权崩溃。资源回收回调在该测试中注入，不能代替真实Electron Main/私有驱动崩溃整轮。此前独立Browser进程组父进程SIGKILL测试证据继续保留。

当前249项相关回归通过/6条件跳过，独立13项ledger/journal核心测试通过（后续新增纯聊天空ledger用例已包含于249项回归）；类型检查通过。首次崩溃夹具误加version字段失败保留，修正后真实HTTP用例第2/3轮通过。日志 `/tmp/xopc-grant-ledger-{manager-1,manager-2,manager-3,regression-1,core-1,core-2,typecheck-4}.log`。

候选DMG摘要 `447cebbe2372faf389b6417d1e190034d44eeab81d1c05260400f37f8e17c9a2`，实际包375个资源/673个runtime验证通过。正式身份安装副本摘要 `e6232c3cafff46789603f74a648184e744eb65e35992918852ec3e1fc69d6de3`，严格串行第2轮本地新启动/旧v266复用及远端聊天恢复通过，包摘要不变。第1轮本地/远端有7秒时间重叠，原报告保留但不作为本轮串行验收证据。Native副本仅Info.plist与签名身份有预期差异。

Computer新增取消输入Native两轮尚未通过：原生目标/输入批准阶段超时，Host已停止并确认停止回执，仍保留unknown；原时限不变。不得将其计为通过。另发现程序超时可误报未await，修复与单独验证正在进行，不包含于本候选DMG。失败摘要见pending-computer-fault-attempts.json；原报告/日志保留且不提交启动凭据预览。

P4、容器磁盘约束/管理、Computer完整原生故障矩阵、独立主机实际模型Host和最终main合并/构建仍待完成。性能预算、原失败和旧S5长测不变。
