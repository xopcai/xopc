# 更新

xopc 可从 npm  registry（全局安装）或 git 检出（fetch/rebase/build）检查并安装新版本。核心包更新成功后，会自动 **同步 lockfile 管理的扩展**，并在合适时 **重启 gateway**（与 OpenClaw 对齐）。

参见：[CLI `update`](./cli.md#update-更新) · [Gateway 更新 API](./gateway.md#更新) · [扩展 post-update 同步](./extensions.md#更新后扩展同步) · [配置 `update.*`](./configuration.md#update-更新)

---

## 快速开始

```bash
# 仅检查，不安装
xopc update --check

# 按配置通道安装（默认 stable）
xopc update

# 安装后不重启 gateway
xopc update --no-restart

# JSON 输出（含 postUpdate.extensions / postUpdate.restart）
xopc update --yes --json
```

**Git 检出（dev）：** `xopc update` 在包根目录执行 `git fetch` / `rebase` / `pnpm install` / `build` / `doctor`。需要 **干净工作区**（先 commit 或 stash 本地修改）。

**全局 npm 安装：** 使用分阶段安装 + 原子替换（非就地 `npm install -g`）。

---

## 更新通道

在 `~/.xopc/xopc.json` 的 `update.channel` 配置（可用 `xopc update --channel` 覆盖）：

| 通道 | npm dist-tag | 典型场景 |
|------|--------------|----------|
| `stable` | `latest` | 生产环境全局安装 |
| `beta` | `beta` | 预发布测试 |
| `dev` | `dev` | 最新 npm 标签；git 检出默认走 dev |

```json
{
  "update": {
    "channel": "stable",
    "checkOnStart": true,
    "auto": {
      "enabled": false,
      "stableDelayHours": 6,
      "stableJitterHours": 12,
      "betaCheckIntervalHours": 1
    }
  }
}
```

| 键 | 默认值 | 说明 |
|----|--------|------|
| `checkOnStart` | `true` | Gateway 启动时查询 npm（启用 auto 时还会定时检查） |
| `auto.enabled` | `false` | 由 Gateway 自动安装 npm 更新（仅 stable/beta；git 工作区永不自动装） |
| `auto.stableDelayHours` | `6` | 稳定版首次发现后等待多久再安装 |
| `auto.stableJitterHours` | `12` | 额外随机延迟，分散稳定版推送 |
| `auto.betaCheckIntervalHours` | `1` | 同一 beta 版本两次自动尝试的最小间隔（小时） |

设置 **`commands.restart: false`** 可禁用更新后的自动重启及 SIGUSR1 重启策略。

---

## `xopc update` 执行流程

1. **核心更新** — 识别安装面（git / 全局 npm），获取更新锁，执行安装步骤。
2. **扩展同步** — 刷新 `~/.xopc/extensions.lock` 中的扩展（npm、xopc-store）。**`dev`** 通道下，若扩展在 **bundled** 中也有同名副本，则跳过 npm 更新（优先 bundled）。
3. **Gateway 重启** — 除非 `--no-restart` 或 `commands.restart: false`：
   - **CLI、非 gateway 进程：** 若 LaunchAgent/systemd/计划任务已加载则 `service.restart()`；否则向配置端口上的未托管进程发 SIGUSR1。
   - **Gateway 进程内**（`XOPC_SERVICE_MARKER=1`）：`triggerGatewayProcessRestart()`（优雅关闭 HTTP + 新 PID）。
   - **启动时自动更新：** 安装成功后同样走进程内重启。

CLI（`--json`）与 Gateway API 在 `postUpdate` 中返回扩展与重启结果（字段含义见 [英文 update 文档](../update.md#what-happens-on-xopc-update)）。

---

## 控制台

Web UI 在有新版本时显示更新提醒（`GET /api/update/status`）。点击应用更新会调用 `POST /api/update/run/stream`（SSE 进度），成功后自动扩展同步并进程内重启。

需要 **admin** operator scope（`operator.admin`）。

---

## 手动同步扩展

`xopc extensions update` 仅刷新 lockfile 中的扩展（不更新 xopc 核心包）。核心更新会自动调用相同逻辑：

```bash
xopc extensions update
xopc extensions update my-ext
```

---

## 故障排除

### 更新时报 `spawn npm ENOENT`

Gateway 或 daemon 的 **PATH 往往很精简**（无 nvm）。xopc 在 CLI/Gateway 启动时会 prepend 稳定 Node/npm 路径。若仍失败：

1. 在普通终端执行一次 `xopc update`。
2. 重装服务：`xopc gateway service install --force`。
3. 确保服务用户 PATH 中有 `npm`（或使用非 nvm 的全局 Node）。

### 跳过：`dirty`

Git 更新需要干净工作区。提交、stash 或丢弃修改后重试。

### 跳过：`not-global-install`

非 git、非全局的安装（如 `pnpm link`）不会自动升级。请用对应包管理器更新后手动 `xopc gateway restart`。

### 扩展同步失败（`post-update-extensions`）

某 lockfile 扩展重装失败。检查 npm/store 源与网络，执行 `xopc extensions update <id>`，再 `xopc gateway restart`。

### 重启被禁用或失败

- 检查配置中的 `commands.restart`。
- `XOPC_NO_RESPAWN=1` 会禁用进程内 respawn。
- 更新成功后可用 `xopc gateway restart --wait 30s` 手动重启。

---

## 实现位置

| 模块 | 路径 |
|------|------|
| 统一 runner | `src/infra/update-runner.ts` |
| 全局 npm 分阶段安装 | `src/infra/update-global.ts`、`src/infra/package-update-steps.ts` |
| 扩展 post-sync | `src/extensions/update.ts` |
| 重启策略 | `src/infra/update-restart.ts` |
| 启动检查 / 自动更新 | `src/infra/update-startup.ts` |
| CLI | `src/cli/commands/update.ts` |
| Gateway API | `src/gateway/hono/routes/update.ts` |
