# P3c 本机 Docker 命令与 PTY 契约

2026-11-01 用户明确接受本机Docker隔离后端。现有本地模式的shell/PTY保持原路径。远端模式新增独立容器执行授权，不从设备登记、剪贴板或本机目录授权推导。

## 执行与数据边界

Main仅连接本机Unix socket，忽略DOCKER_HOST和远端上下文，要求Docker Engine身份固定。不把Docker API、socket、任意容器ID、挂载选项、主机环境变量或凭据交给Renderer/Agent。不自动拉取镜像；用户原生确认已安装镜像的不可变image ID、独立容器工作区和有效期。

首版工作区为Docker管理的专用卷，不自动挂载用户电脑目录；文件交换仍需显式授权。每个命令使用独立容器和稳定operationId，卷在该工作区内延续。容器使用非root、只读根文件系统、无网络、无主机绑定、cap-drop ALL、no-new-privileges及CPU/内存/PID/输出限制；只能使用镜像内的程序。Docker隔离依赖本机Engine与内核，不能宣称抵抗所有内核漏洞。参数依据[Docker容器创建接口](https://docs.docker.com/reference/cli/docker/container/create/)和[Engine安全边界](https://docs.docker.com/engine/security/)核对。

命令是结构化argv，不能作为Docker参数解释。PTY另用有序字节流、输入/resize、背压、结束与断开协议，不用普通工具progress冒充终端流。服务器默认shell仍在服务器运行。

## 持久记录与停止证明

执行前持久保存已绑定意图的本机加密资源元数据。先记录创建意图，再创建容器；获取不可变CID后必须持久化，再发送start。禁止把create和start合并成不可核实的一次run，也不在网络错误后自动重发start。

停止时删除精确CID并核实同一Engine上该CID不存在，以阻止尚在途中的start和遗留子进程。只杀HTTP客户端、命令PID退出、docker stop已发送或容器看似not-running均不作为充分证明。Main崩溃后，原running意图转unknown；新执行必须先核实对应容器已销毁。Engine不可达/身份变化/资源身份不符时保持停止未确认与执行权阻断，不能用人工勾选替代停止证明。

卷的文件副作用可能已经发生。清理容器不将旧结果改成成功或失败；人工核实后只能授权新的意图，不能重做旧operationId。未知记录与对应卷保留供检查，不自动删除。临时卷清理需与不确定结果、PTY退出和生命周期分别核实。

## 验收顺序

1. 本机socket适配器与资源边界：真实Engine固定身份、无本机挂载/网络/凭据继承、非root写入专用卷、输出/PID/内存限额，首次失败保留。
2. 稳定资源记录与命令监督：create/start各处丢回执、取消、超时、Main崩溃、daemon不可达/替换，拒绝自动重试，原停止预算不变。
3. 独立设备授权与签名调用、原生逐次批准、真实Agent/安装包与本地回归。
4. PTY有序流、重连不重放输入、背压、容器销毁和卷保留；再接显式文件交换与P4后台期限。

这是实施契约，尚不表示命令或PTY已开放或验收通过。
