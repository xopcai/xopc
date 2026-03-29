# 构建与发布

本文说明如何在本地或 CI 中完成 **Node 包构建**、**npm 发布** 与 **Electron 桌面端打包**，以及与 GitHub Actions 的对应关系。

## 环境与工具

| 要求 | 说明 |
|------|------|
| Node.js | `>= 22`（与 `package.json` 的 `engines` 一致） |
| 包管理器 | **pnpm**（仓库使用 `pnpm-lock.yaml`，勿提交 `package-lock.json`） |
| 工作区 | 根目录、`web/`、`extensions/*` 见 `pnpm-workspace.yaml` |

安装依赖：

```bash
pnpm install
```

---

## 全量构建（CLI + 网关静态资源）

根目录脚本：

```bash
pnpm run build
```

等价于依次执行：

1. **`pnpm run generate:bundled-channels`** — 生成 `src/generated/bundled-channel-plugins.ts` 等通道插件清单。
2. **`pnpm run build:node`** — 通过 `scripts/tsdown-build.mjs` 调用 **tsdown**（配置见仓库根目录 `tsdown.config.ts`），输出到 `dist/`，含 ESM、类型声明与 source map。
3. **`pnpm run build:web`** — 在 `web/` 包内执行 `tsc -b && vite build`，网关控制台产物写入 `dist/gateway/static/root`（与 AGENTS.md 中说明一致）。

仅做类型检查（不产出 `dist`）：

```bash
pnpm run typecheck
```

---

## npm 发布（`@xopcai/xopcbot`）

### 包信息

- **包名**：`@xopcai/xopcbot`（作用域包）。
- **入口**：`dist/src/index.js`，类型 `dist/src/index.d.ts`；CLI 二进制 `dist/src/cli/index.js`（命令名 `xopcbot`）。
- **发布包含文件**：`package.json` 的 `files` 字段为 `dist` 与 `skills`（不含源码）。
- **可见性**：`publishConfig.access` 为 `public`。

### 发布前自动步骤（`prepublishOnly`）

在 **`npm publish`** 或 **`pnpm publish`** 时，会先执行：

```text
npm test && npm run test:skills:all && npm run build
```

即：单元测试 → 技能相关测试脚本 → 全量构建。请确保本地或通过 CI 已能通过上述检查。

### 发布流程建议

1. 更新版本号：编辑根目录 `package.json` 的 `version`（或 `pnpm version patch|minor|major`）。
2. 提交并打标签（若团队用 tag 驱动发版，与 Electron CI 的 `v*` 标签约定一致）。
3. 登录 npm（首次）：`npm login`（需有 `@xopcai` 作用域发布权限）。
4. 在仓库根目录执行：

   ```bash
   pnpm publish
   ```

   若仅做 dry-run：

   ```bash
   pnpm publish --dry-run
   ```

> **说明**：日常开发使用 `pnpm`；`prepublishOnly` 里写的是 `npm test` / `npm run`，在 pnpm 下发布时钩子仍会按 `package.json` 执行。

---

## Electron 桌面应用构建

Electron 使用 **electron-vite** 打包主进程 / preload / 渲染进程，再用 **electron-builder** 生成各平台安装包。配置：

- **electron-vite**：`electron.vite.config.ts`（主进程入口 `electron/main.ts`，preload `electron/preload.ts`，渲染进程根目录为 `web/`）。
- **electron-builder**：`electron-builder.yml`（`appId`、`productName`、输出目录 `dist/release`、打包 `out/**`、`dist/**` 等）。

### 本地命令

| 命令 | 作用 |
|------|------|
| `pnpm run electron:dev` | 开发模式（需本机网关等按项目文档自行启动时，渲染进程代理见 `electron.vite.config.ts`） |
| `pnpm run electron:build` | 先 `electron-vite build`，再 `electron-builder`，产物在 **`dist/release/`** |
| `pnpm run electron:preview` | 预览构建结果 |

**推荐顺序**（与 CI 一致）：先完成 Node + Web 全量构建，再打 Electron 包：

```bash
pnpm run build
pnpm run electron:build
```

`electron-builder` 会将 `@vscode/ripgrep` 的二进制放入额外资源目录（见 `electron-builder.yml` 的 `extraResources`）。

### 各平台产物（默认配置）

- **macOS**：按 `mac` 配置（`electron-builder.yml` 中 `category` 等）。
- **Windows**：NSIS 安装包（`win.target: nsis`）。
- **Linux**：AppImage 与 deb（`linux.target`）。

具体文件名以构建日志与 `dist/release` 目录为准。

### macOS 签名与公证（可选）

若需对外分发已签名、公证的 macOS 应用，需在构建环境配置 **electron-builder** 文档中的证书与 Apple 账号相关变量。GitHub Actions 工作流 `.github/workflows/electron-build.yml` 注释中列出了常见 secret 名称（`CSC_LINK`、`CSC_KEY_PASSWORD`、`APPLE_ID` 等），按团队策略在 CI 或本机注入即可。

---

## GitHub Actions 与发版联动

### Electron 构建（`Electron Build`）

- **文件**：`.github/workflows/electron-build.yml`
- **触发**：手动 `workflow_dispatch`，或推送 **`v*` 标签**（例如 `v0.2.3`）。
- **矩阵**：`macos-latest`、`windows-latest`、`ubuntu-latest` 各打一份。
- **步骤**：`pnpm install --frozen-lockfile` → `pnpm run build` → `pnpm run electron:build` → 上传 Artifact（`dist/release`，保留 14 天）。

从 Actions 界面下载各平台 Artifact 即可获取安装包；是否再上传到 GitHub Release 需自行在工作流中扩展。

### 文档站点（VitePress）

- **文件**：`.github/workflows/docs.yml`
- **触发**：`main` 分支推送且变更路径包含 `docs/**` 等。
- **构建**：`pnpm exec vitepress build docs`，部署到 GitHub Pages（与「npm/Electron 发布」独立）。

### 技能测试（`Skills Test`）

在变更 `skills/` 等路径时运行；含多 Job 的测试与安全审计，**不**等同于 npm 发版流程，但发版前本地已通过 `prepublishOnly` 中的技能测试更有利于稳定。

---

## 命令速查

```bash
# 全量构建
pnpm run build

# 仅 Node（tsdown）
pnpm run build:node

# 仅网关控制台
pnpm run build:web

# 测试（与 prepublishOnly 前半部分对应）
pnpm test
pnpm run test:skills:all

# Electron
pnpm run build && pnpm run electron:build

# 文档（本地）
pnpm run docs:dev
pnpm run docs:build
```

---

## 相关文件索引

| 主题 | 路径 |
|------|------|
| 根构建脚本 | `package.json`（`scripts.build`、`prepublishOnly`） |
| tsdown | `tsdown.config.ts`、`scripts/tsdown-build.mjs` |
| Web 子包 | `web/package.json` |
| Electron | `electron.vite.config.ts`、`electron-builder.yml`、`electron/` |
| CI：Electron | `.github/workflows/electron-build.yml` |
| CI：文档 | `.github/workflows/docs.yml` |
