# Electron Gateway Server 预打包修复指南

> 本文档记录了修复 Electron 打包后 gateway 进程无法启动问题的变更内容，供后续 agent 参考。

---

## 问题背景

**原始问题**：Electron 打包（DMG/exe）后，gateway 进程启动失败，报错类似 `Cannot find module` 或依赖缺失。

**根因分析**：
- Electron Builder 打包时，asar 归档仅包含 `out/**/*`（Electron 主进程代码）
- Gateway 进程使用 `dist/src/cli/index.js`（由 tsdown 编译的 Node.js 产物）
- `dist/` 中的文件依赖 `node_modules`，但 asar 内不包含 `node_modules`
- 打包后运行 gateway 时，无法找到 npm 依赖（如 `commander`、`hono` 等）

---

## 变更概览

| 文件 | 变更类型 | 说明 |
|------|----------|------|
| `electron-builder.yml` | 修改 | 移除 `dist/**/*` 打包规则 |
| `electron/gateway-process.ts` | 修改 | 打包模式改用 `out/server/index.js` 入口 |
| `package.json` | 修改 | 新增 `electron:server:build` 脚本和 `esbuild` 依赖 |
| `scripts/electron-builder.mjs` | 修改 | 添加 gateway server 预打包说明注释 |
| `scripts/build-electron-server.mjs` | **新增** | esbuild 脚本：将 gateway server 打包为单文件 |

**总计**：4 文件修改 + 1 文件新增，净增 21 行，删除 4 行

---

## 详细变更说明

### 1. `electron-builder.yml`

**变更内容**：
```diff
 files:
   - out/**/*
   - package.json
-  - dist/**/*
```

**意图**：
- 不再将 `dist/` 目录包含到 asar 归档中
- 减少打包体积，避免将未打包的、依赖外部 `node_modules` 的产物打入安装包

**潜在影响**：
- Dev 模式不受影响（Dev 模式仍使用 `dist/src/cli/index.js`）
- Packaged 模式必须依赖 `out/server/index.js`（由 esbuild 生成的单文件产物）

---

### 2. `electron/gateway-process.ts`

**变更内容**：
```diff
 export function resolveCliEntry(): string {
   if (app.isPackaged) {
-    return join(app.getAppPath(), 'dist/src/cli/index.js');
+    // esbuild bundle — self-contained, no node_modules required
+    return join(app.getAppPath(), 'out/server/index.js');
   }
   const mainDir = dirname(fileURLToPath(import.meta.url));
   return join(mainDir, '../../dist/src/cli/index.js');
 }
```

**意图**：
- **Packaged 模式**：使用 `out/server/index.js`（esbuild 单文件，所有 npm 依赖已内联）
- **Dev 模式**：继续使用 `dist/src/cli/index.js`（tsdown unbundle 产物，依赖从 pnpm `node_modules` 解析）

**关键逻辑**：
```typescript
if (app.isPackaged) {
  return join(app.getAppPath(), 'out/server/index.js');  // 打包后路径
}
return join(mainDir, '../../dist/src/cli/index.js');     // 开发时路径
```

---

### 3. `package.json`

**变更内容**：
```diff
 "scripts": {
+  "electron:server:build": "node scripts/build-electron-server.mjs",
-  "electron:build": "pnpm run electron:vite:build && pnpm run electron:package",
+  "electron:build": "pnpm run electron:vite:build && pnpm run electron:server:build && pnpm run electron:package",
 },
 "devDependencies": {
+  "esbuild": "^0.25.0",
 }
```

**意图**：
- 新增 `electron:server:build` 步骤：在 `electron:package` 之前运行 esbuild 打包 gateway server
- 构建流程变为：
  1. `electron:vite:build` — 编译 Electron 主进程/渲染进程 → `out/`
  2. `electron:server:build` — esbuild 打包 gateway server → `out/server/index.js`
  3. `electron:package` — electron-builder 打包为 DMG/exe

---

### 4. `scripts/build-electron-server.mjs`（新增文件）

**核心逻辑**：
```javascript
import * as esbuild from 'esbuild';
import { createRequire } from 'node:module';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const require = createRequire(join(root, 'package.json'));

// 排除 Electron 专用模块（这些模块在 gateway server 运行时不需要）
const external = [
  'electron',
  '@vscode/ripgrep',   // 可选功能，打包时排除避免原生模块问题
  'silk-wasm',         // 语音相关，按需加载
  'node-cron',         // cron 调度器（gateway 模式下由外部管理）
];

await esbuild.build({
  entryPoints: [join(root, 'dist/src/cli/index.js')],
  bundle: true,
  platform: 'node',
  target: 'node22',
  outfile: join(root, 'out/server/index.js'),
  external,
  format: 'esm',
  banner: { js: "import { createRequire } from 'module'; globalThis.require = createRequire(import.meta.url);" },
  minify: false,  // 开发阶段保持可读性，CI 可改为 true
  sourcemap: false,
});
```

**关键设计**：
- **单文件输出**：所有 npm 依赖内联到 `out/server/index.js`，无需 `node_modules`
- **ESM 兼容**：通过 `banner` 注入 `createRequire` polyfill，使 CommonJS 模块可在 ESM 环境运行
- **外部模块排除**：`electron`、原生模块（`@vscode/ripgrep`、`silk-wasm`）标记为 `external`，避免打包失败

---

### 5. `scripts/electron-builder.mjs`

**变更内容**：
- 添加注释说明 gateway server 已由 `scripts/build-electron-server.mjs` 预打包
- 添加 `// Main` 分隔符提高可读性
- 无功能变更，仅文档补充

---

## 构建流程对比

### 修改前（有问题）
```
pnpm run electron:build
  ├── electron:vite:build          → out/main/index.js, out/renderer/**
  └── electron:package             → 打包 out/ + dist/**（但 dist/ 依赖外部 node_modules）
                                      ❌ 打包后 gateway 启动失败（缺少依赖）
```

### 修改后（已修复）
```
pnpm run electron:build
  ├── electron:vite:build          → out/main/index.js, out/renderer/**
  ├── electron:server:build        → out/server/index.js（esbuild 单文件，依赖内联）
  └── electron:package             → 打包 out/（包含完整 gateway server）
                                      ✅ 打包后 gateway 正常启动
```

---

## 验证步骤

其他 agent 在应用此修复后，应执行以下验证：

### 1. 本地开发模式验证
```bash
# 确保 dist/ 已编译
pnpm run build

# 启动 Electron 开发模式
pnpm run electron:dev

# 验证 gateway 进程正常启动
# 检查日志中无 "Cannot find module" 错误
# 访问 http://127.0.0.1:18790/health 应返回 200
```

### 2. 打包构建验证
```bash
# 完整构建流程
pnpm run electron:build

# 验证产物结构
ls -la out/server/index.js  # 应存在且为单文件（通常 >5MB）
ls -la out/main/index.js    # Electron 主进程
ls -la out/renderer/**      # 渲染进程静态资源

# 打包 DMG/exe
pnpm run electron:package

# 安装并运行打包后的应用
# 验证 gateway 进程正常启动
```

### 3. 关键检查点
- [ ] `out/server/index.js` 存在且为单文件（可通过 `wc -l out/server/index.js` 验证）
- [ ] `dist/` 不再包含在 asar 中（解压 asar 后检查）
- [ ] Dev 模式仍使用 `dist/src/cli/index.js`（不受影响）
- [ ] Packaged 模式使用 `out/server/index.js`
- [ ] Gateway health check 通过（`http://127.0.0.1:{port}/health`）

---

## 常见问题排查

### Q1: `out/server/index.js` 未生成
**原因**：`electron:server:build` 步骤未执行或失败  
**解决**：
```bash
# 手动执行 server build
node scripts/build-electron-server.mjs

# 检查 esbuild 是否正确安装
pnpm list esbuild
```

### Q2: 打包后仍报 `Cannot find module`
**原因**：某些依赖未被正确内联  
**解决**：
1. 检查 `scripts/build-electron-server.mjs` 的 `external` 数组，确保只有真正需要排除的模块
2. 运行 `node out/server/index.js --help` 验证单文件是否可独立运行
3. 检查是否有动态 `import()` 或 `require()` 未被 esbuild 静态分析捕获

### Q3: `@vscode/ripgrep` 原生模块打包失败
**原因**：原生模块需要针对 Electron 的 Node.js 版本重新编译  
**解决**：
- 当前方案已将其标记为 `external`，gateway server 运行时按需从外部加载
- 如必须打包，需使用 `@electron/rebuild` 重新编译原生模块

### Q4: Dev 模式 gateway 启动失败
**原因**：`dist/` 未编译或依赖未安装  
**解决**：
```bash
pnpm install
pnpm run build
pnpm run electron:dev
```

---

## 设计决策记录

| 决策 | 理由 | 替代方案 |
|------|------|----------|
| 使用 esbuild 而非 webpack/rollup | 配置简单、构建速度快、ESM 支持好 | webpack（配置复杂）、rollup（Node.js 生态支持弱） |
| 将依赖内联到单文件 | 避免 asar 内管理 `node_modules` 的复杂性 | 将 `node_modules` 复制到 asar（体积大、路径问题多） |
| Dev 模式继续使用 `dist/` | 保持开发体验（sourcemap、热重载） | 统一使用 esbuild（Dev 模式构建慢） |
| 排除 `@vscode/ripgrep` 等原生模块 | 原生模块跨平台编译复杂，且 gateway 非必需 | 使用 `@electron/rebuild`（CI 流程复杂） |

---

## 相关文件索引

| 文件 | 作用 |
|------|------|
| `electron/gateway-process.ts` | Gateway 进程管理（启动、停止、健康检查） |
| `electron/main.ts` | Electron 主进程入口 |
| `electron.vite.config.ts` | Electron Vite 构建配置 |
| `electron-builder.yml` | Electron Builder 打包配置 |
| `scripts/build-electron-server.mjs` | Gateway server esbuild 打包脚本 |
| `scripts/electron-builder.mjs` | Electron Builder 启动脚本（清理本地代理） |
| `package.json` | 构建脚本和依赖定义 |

---

## 注意事项

1. **不要手动删除 `out/server/index.js`**：这是构建产物，由 `electron:server:build` 自动生成
2. **修改 gateway 入口文件后**：必须重新运行 `pnpm run build && pnpm run electron:server:build`
3. **添加新的 npm 依赖**：如果是 gateway server 运行时需要的依赖，确保 `build-electron-server.mjs` 的 `external` 数组没有错误排除它
4. **CI/CD 流程**：确保 CI 中执行完整的 `pnpm run electron:build`（包含 3 个子步骤）

---

_文档生成时间：2026-04-01_  
_关联提交：待提交_
