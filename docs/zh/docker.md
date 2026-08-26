# 使用 Docker 安装

官方容器镜像可以直接运行 xopc gateway 和 CLI，宿主机不需要安装 Node.js 或 pnpm。

- 镜像：`ghcr.io/xopcai/xopc`
- 平台：`linux/amd64` 和 `linux/arm64`
- Gateway 端口：`18790`
- 容器内状态目录：`/home/node/.xopc`

初次安装可以使用 `latest`。正式环境建议固定为[镜像包页面](https://github.com/xopcai/xopc/pkgs/container/xopc)列出的具体版本，例如 `ghcr.io/xopcai/xopc:0.0.201`。

## 环境要求

macOS 或 Windows 安装 Docker Desktop；Linux 安装 Docker Engine 和 Compose 插件。先确认安装正常：

```bash
docker --version
docker compose version
```

## 快速启动

先创建 Docker 管理的数据卷。这样替换或升级容器时，配置、会话、日志和工作区不会丢失：

```bash
docker volume create xopc-data
```

启动 gateway。端口绑定到 `127.0.0.1`，表示只有当前电脑可以访问：

```bash
docker run -d \
  --name xopc-gateway \
  --restart unless-stopped \
  -p 127.0.0.1:18790:18790 \
  -e TZ=Asia/Shanghai \
  -v xopc-data:/home/node/.xopc \
  ghcr.io/xopcai/xopc:latest
```

查看启动日志并等待健康检查完成：

```bash
docker logs -f xopc-gateway
```

打开 [http://127.0.0.1:18790](http://127.0.0.1:18790)，在网页控制台完成模型配置。按 `Ctrl+C` 只会停止跟踪日志，不会停止容器。

随时可以检查版本和健康状态：

```bash
docker exec xopc-gateway xopc --version
curl http://127.0.0.1:18790/api/health
```

## 将数据保存在宿主机目录

如果希望直接在宿主机的 `~/.xopc` 中查看状态文件，可以改用目录挂载：

```bash
mkdir -p "$HOME/.xopc/workspace"

docker run -d \
  --name xopc-gateway \
  --restart unless-stopped \
  -p 127.0.0.1:18790:18790 \
  -e TZ=Asia/Shanghai \
  -v "$HOME/.xopc:/home/node/.xopc" \
  ghcr.io/xopcai/xopc:latest
```

容器使用非 root 的 `node` 用户运行，其 UID 是 `1000`。在 Linux 上，需要确保 UID `1000` 对挂载目录有写权限。不熟悉 Linux 文件权限时，优先使用快速启动中的 Docker 数据卷。

不要同时运行两个使用相同名称的容器。切换存储方式前先删除旧容器：

```bash
docker rm -f xopc-gateway
```

## 使用 Docker Compose

创建一个空目录并下载仓库提供的 Compose 文件：

```bash
mkdir xopc-docker
cd xopc-docker
curl -fsSLO https://raw.githubusercontent.com/xopcai/xopc/main/docker-compose.yml
```

在该目录创建 `.env` 文件：

```dotenv
XOPC_IMAGE=ghcr.io/xopcai/xopc:latest
XOPC_GATEWAY_PORT=18790
XOPC_STATE_DIR=/绝对路径/.xopc
XOPC_WORKSPACE=/绝对路径/.xopc/workspace
XOPC_TZ=Asia/Shanghai
```

把两个 `/绝对路径` 换成真实路径。例如 Linux 用户 `alice` 可以使用 `/home/alice/.xopc`。如果以后在 `.env` 中加入 API Key 或 Token，不要把它提交到 Git 仓库。

拉取并启动正式镜像：

```bash
docker compose pull xopc-gateway xopc-cli
docker compose up -d xopc-gateway
docker compose ps
```

常用 Compose 命令：

```bash
docker compose logs -f xopc-gateway
docker compose run --rm xopc-cli --version
docker compose restart xopc-gateway
docker compose down
```

`docker compose down` 会删除容器和网络，但不会删除宿主机状态目录。

## 配置环境变量

镜像支持普通安装方式中的模型厂商环境变量。需要时可以传入本地环境文件：

```bash
docker run -d \
  --name xopc-gateway \
  --restart unless-stopped \
  --env-file .env \
  -p 127.0.0.1:18790:18790 \
  -v xopc-data:/home/node/.xopc \
  ghcr.io/xopcai/xopc:latest
```

也可以直接在网页控制台配置模型。不要把 API Key 放进 shell 历史、Git 仓库、截图或容器日志。

## 升级

拉取新镜像并重新创建容器。数据仍保存在 `xopc-data` 中：

```bash
docker pull ghcr.io/xopcai/xopc:latest
docker rm -f xopc-gateway

docker run -d \
  --name xopc-gateway \
  --restart unless-stopped \
  -p 127.0.0.1:18790:18790 \
  -e TZ=Asia/Shanghai \
  -v xopc-data:/home/node/.xopc \
  ghcr.io/xopcai/xopc:latest
```

使用 Compose 时：

```bash
docker compose pull
docker compose up -d
```

需要部署结果完全可复现时，把 `XOPC_IMAGE` 从 `latest` 改为具体版本号。

## 让其它设备访问

快速启动命令只允许本机访问。不要把没有认证保护的 gateway 直接暴露到公网。

需要局域网访问时，把端口参数改为 `-p 18790:18790`，配置 gateway token，并使用防火墙限制访问范围。需要公网或异地访问时，请继续阅读[安全暴露 gateway](./how-to/expose-gateway-safely.md)或[远程访问](./remote-access.md)。

## 常见问题

| 现象 | 检查方法 |
| --- | --- |
| `/home/node/.xopc` 出现 `permission denied` | 使用 Docker 数据卷，或确保 UID `1000` 可以写入宿主机挂载目录 |
| 端口 `18790` 已被占用 | 停止旧服务，或更换宿主机端口，例如 `-p 127.0.0.1:18791:18790` |
| 容器启动后立即退出 | 执行 `docker logs xopc-gateway` 查看原因 |
| 网页控制台打不开 | 执行 `docker ps` 和 `curl http://127.0.0.1:18790/api/health` |
| 无法拉取镜像 | 在[镜像包页面](https://github.com/xopcai/xopc/pkgs/container/xopc)确认标签；如果镜像还是私有状态，执行 `docker login ghcr.io` |
| 容器访问不到本机模型 | 容器内的 `127.0.0.1` 不是宿主机；在支持的平台上改用 `host.docker.internal` |

只检查镜像内 CLI、不启动 gateway：

```bash
docker run --rm ghcr.io/xopcai/xopc:latest xopc --version
```
