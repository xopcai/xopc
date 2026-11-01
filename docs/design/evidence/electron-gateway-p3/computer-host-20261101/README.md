# Computer 独立 Host HTTP/WSS 整链路

实际 Hono Gateway、独立设备凭据/请求证明、签名 Realtime 双向帧、DesktopExecutionHost、持久 Gateway intent 与本机 journal、专用 ComputerBroker、HTTP 内存帧上传均参与测试。原生驱动、OS 存储与确认回调注入；不是安装包原生桌面或物理 WAN 验收。

第二轮两场景通过：取消首次调用不启动驱动；逐次批准后 discover/open/observe/act/release；本机 journal 与 ready 资源屏障先于输入；同 actionId/参数不重复输入；截图经专用交接后清零且未写磁盘。故障场景在 Gateway 已核验签名的结果派发点丢弃 tool.result，并断开设备：本机 succeeded 记录保留、停止已确认，Gateway 为 unknown，不重做输入。

首轮失败保留：新适配器误把持久外部操作租约设为与 30 秒本机调用期限相同，记录/派发耗时使 intent 未能落入该租约；源代码确认 Gateway 行 state unknown、desktop_intent_json 为空，尚未派发。修正为复用原 external-operation 默认租约，未改 30 秒 invocation 或 3 秒停止预算。确定性递增时钟回归防止租约再次覆盖不足。原日志 `/tmp/xopc-p3d-computer-host-e2e-1.log`；失败夹具 `.../T/xopc-computer-host-V8A9EX` 与 `.../T/xopc-computer-host-IUeDBM` 保留。

`/tmp/xopc-p3d-computer-host-e2e-2.log` 两场景通过；`/tmp/xopc-p3d-computer-host-regression-1.log` 共12项通过，含既有实际Docker终端与丢ACK监督整链路、原执行Host及租约专项。全类型检查 `/tmp/xopc-p3d-computer-host-typecheck-2.log` 通过。

Electron Main 原生入口、真实驱动及 Native 安装包验证尚未完成，不能标记 P3d 完成。完整方案后续 Browser、卷/磁盘约束、P4 仍需推进；未合入 main。
