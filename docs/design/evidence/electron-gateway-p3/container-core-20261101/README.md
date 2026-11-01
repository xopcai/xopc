# P3c-1 本机Docker命令监督核心

用户已明确接受Docker隔离后端。本阶段尚未接入远端Host、Native授权或Agent，不代表命令/PTY已开放；现有本地main路径无新增导入。按[容器契约](../../../electron-gateway-p3-container-contract.md)继续后续接线。

## 已实现

本机Unix socket专用HTTP适配器固定Engine身份，不读取DOCKER_HOST或传递主机环境/凭据。镜像必须已安装并固定不可变ID，不自动拉取。专用卷校验名称/driver/归属；容器非root、无网络、只读root、cap-drop ALL、no-new-privileges、64 PID、256MiB内存、1 CPU及有界日志/输出，不挂载本机目录或Docker socket。

加密资源记录绑定完整操作意图、Engine、卷/工作区、image ID与argv。先持久记录prepared，获取CID后加密落盘并fsync目录，才允许start。启动没有隐式重试。每个命令独立容器，共享本授权的专用卷；正常结果也要先核实精确CID已删除，命令非零退出作为已完成结果报告，不能伪称没有文件副作用。未知卷效果不因清理容器而恢复成成功。

真实文件journal、OS lease与Supervisor验证终态；Main崩溃后记录unknown，资源核实只删除同Engine、归属匹配的精确CID，不创建或start。原监督停止超时与持久未知阻断继续有效。

## 验证与失败

`XOPC_CONTAINER_LIVE=1 pnpm vitest run electron/__tests__/gateway-connections-container-engine.test.ts electron/__tests__/gateway-connections-container-worker.test.ts` 最终6项通过，Electron类型检查通过。

真实本机Engine验证：非root写入专用卷、下一命令读取卷、实际无host mount/网络和资源限制、stdout/stderr复用、销毁含detached子进程的容器。真实独立Node监督进程SIGKILL后，容器仍运行；新journal保留unknown，核实删除CID后executionStopped为true但unknown不变，新意图仍被阻断。此处是生产TS模块与实际Docker/Node故障测试，未宣称Electron安装包或原生批准验收。

CID持久化失败不发送start；create尚未回执时取消，不允许迟到返回启动命令；停止失败保留未确认，可再次独立核实；重复意图不再创建容器。AES夹具验证资源记录密文与绑定，实际OS safeStorage须在后续Main接线验收，不能混称。

首次真实Engine测试因local日志驱动默认compression与max-file=1冲突而start被拒绝，完整失败保留；显式关闭compression后通过，未增加日志或原性能预算。最终测试后本标签的容器与测试卷均已清理，无批量prune或其他用户资源变更。

后续：签名设备协议、独立容器授权、Native逐次批准/人工核实与真实Agent/安装包；PTY需专用字节流，不能用progress代替；授权卷保留/显式交换与P4继续实施。
