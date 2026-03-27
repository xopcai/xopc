# Electron PC 应用构建方案

> 在 xopcbot 现有 TypeScript + Node.js + React 技术栈基础上，构建跨平台桌面应用并集成本地文本编辑器能力。

---

## 目录

- [技术栈](#技术栈)
- [整体架构](#整体架构)
- [目录结构](#目录结构)
- [进程模型与 IPC](#进程模型与-ipc)
- [构建工具链](#构建工具链)
- [核心模块实现](#核心模块实现)
  - [主进程入口](#主进程入口)
  - [Preload 安全桥接](#preload-安全桥接)
  - [文件系统 IPC](#文件系统-ipc)
  - [ripgrep 全文搜索](#ripgrep-全文搜索)
  - [Agent IPC（复用现有）](#agent-ipc复用现有)
- [打包配置](#打包配置)
- [依赖清单](#依赖清单)
- [实现路线图](#实现路线图)
- [与现有项目的集成关系](#与现有项目的集成关系)

---

## 技术栈

| 模块 | 技术 |
|------|------|
| 语言 | TypeScript（与现有代码库统一） |
| UI 框架 | React 19（复用现有 `web/` 包） |
| 状态管理 | Zustand（复用现有 stores，按需扩展） |
| 桌面壳 | Electron |
| 编辑器内核 | CodeMirror 6 |
| Markdown 解析 | marked + highlight.js |
| 文件存储 | 本地 `.md` 文件 |
| 全文搜索 | ripgrep（`@vscode/ripgrep` 处理多平台分发） |
| 构建工具 | electron-vite |
| 样式 | Tailwind CSS v4（复用 `web/src/styles/globals.css` 设计 token） |
| 打包 | electron-builder |

---

## 整体架构

```
┌─────────────────────────────────────────────────────────────┐
│                      Electron App                            │
│                                                             │
│  ┌──────────────────────┐  IPC   ┌───────────────────────┐  │
│  │    Main Process       │◄──────►│   Renderer Process    │  │
│  │    (Node.js)          │        │   (React + Vite)      │  │
│  │                       │        │                       │  │
│  │  • AgentService       │        │  • CodeMirror 6 编辑器 │  │
│  │    (复用 src/)         │        │  • MarkdownView 渲染   │  │
│  │  • 文件系统读写        │        │  • 文件树组件          │  │
│  │  • ripgrep 搜索        │        │  • Zustand 状态        │  │
│  │  • config loader      │        │  • Tailwind CSS        │  │
│  └──────────────────────┘        └───────────────────────┘  │
│                                                             │
│  ┌──────────────────────────────────────────────────────┐   │
│  │  Preload Script（contextIsolation 安全桥接）           │   │
│  │  window.electronAPI.{ file, search, agent, platform } │   │
│  └──────────────────────────────────────────────────────┘   │
└─────────────────────────────────────────────────────────────┘
```

**安全原则：**
- `contextIsolation: true` — renderer 与 Node.js 完全隔离
- `nodeIntegration: false` — renderer 不能直接调用 Node API
- 所有 Node 能力通过 preload 白名单暴露，防止 XSS 攻击直达文件系统

---

## 目录结构

在现有项目基础上新增 `electron/` 目录，扩展 `web/` 中的编辑器功能：

```
xopcbot/
├── src/                          # 现有 Node.js 核心（主进程直接复用）
├── web/                          # 现有 React UI（扩展编辑器页面）
│   └── src/
│       ├── components/
│       │   └── markdown/         # 新增：统一 Markdown 组件库
│       │       ├── parse-markdown.ts
│       │       ├── markdown-view.tsx
│       │       ├── markdown-editor.tsx
│       │       ├── markdown-split.tsx
│       │       └── markdown.css
│       └── features/
│           ├── editor/           # 新增：编辑器页面功能模块
│           │   ├── editor-page.tsx
│           │   └── editor-store.ts
│           └── file-tree/        # 新增：文件树
│               ├── file-tree.tsx
│               └── file-tree-store.ts
├── electron/                     # 新增：Electron 主进程
│   ├── main.ts                   # 主进程入口
│   ├── preload.ts                # 预加载脚本（IPC 桥接）
│   ├── ipc/
│   │   ├── file-ipc.ts           # 文件读写 IPC handlers
│   │   ├── search-ipc.ts         # ripgrep 搜索 IPC handlers
│   │   └── agent-ipc.ts          # Agent 调用 IPC handlers
│   └── services/
│       └── file-service.ts       # 文件操作工具函数
├── electron-vite.config.ts       # electron-vite 构建配置
└── electron-builder.yml          # 打包配置
```

---

## 进程模型与 IPC

### IPC 通道设计

| 通道 | 方向 | 说明 |
|------|------|------|
| `file:read` | renderer → main | 读取文件内容 |
| `file:write` | renderer → main | 写入文件内容 |
| `file:list-dir` | renderer → main | 列出目录文件树 |
| `file:open-dir-dialog` | renderer → main | 打开系统目录选择对话框 |
| `file:watch` | renderer → main | 注册文件监听 |
| `file:changed:{path}` | main → renderer | 文件被外部修改时推送 |
| `search:ripgrep` | renderer → main | 全文搜索 |
| `agent:send` | renderer → main | 发送消息给 Agent |
| `agent:stream-chunk` | main → renderer | Agent 流式输出推送 |

### Preload 暴露的 API 类型

```typescript
interface ElectronAPI {
  file: {
    readFile(filePath: string): Promise<string>;
    writeFile(filePath: string, content: string): Promise<{ success: boolean }>;
    listDirectory(dirPath: string): Promise<FileEntry[]>;
    openDirectory(): Promise<string | null>;
    watchFile(filePath: string, callback: (content: string) => void): void;
  };
  search: {
    ripgrep(query: string, dirPath: string): Promise<SearchResult[]>;
  };
  agent: {
    sendMessage(message: string, sessionKey: string): Promise<{ done: boolean }>;
    onStream(callback: (chunk: string) => void): void;
  };
  platform: 'darwin' | 'win32' | 'linux';
}

declare global {
  interface Window {
    electronAPI: ElectronAPI;
  }
}
```

---

## 构建工具链

### electron-vite 配置

**`electron-vite.config.ts`**（项目根目录）：

```typescript
import { defineConfig, externalizeDepsPlugin } from 'electron-vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'
import { resolve } from 'path'

export default defineConfig({
  main: {
    plugins: [externalizeDepsPlugin()],
    build: { outDir: 'dist/electron/main' },
    resolve: {
      alias: { '@': resolve('src') }
    }
  },
  preload: {
    plugins: [externalizeDepsPlugin()],
    build: { outDir: 'dist/electron/preload' }
  },
  renderer: {
    root: 'web',
    plugins: [react(), tailwindcss()],
    build: { outDir: 'dist/electron/renderer' },
    resolve: {
      alias: { '@': resolve('web/src') }
    }
  }
})
```

### package.json 新增脚本

```json
{
  "scripts": {
    "electron:dev": "electron-vite dev",
    "electron:build": "electron-vite build && electron-builder",
    "electron:preview": "electron-vite preview"
  },
  "devDependencies": {
    "electron": "^34.0.0",
    "electron-vite": "^3.0.0",
    "electron-builder": "^25.0.0"
  }
}
```

---

## 核心模块实现

### 主进程入口

**`electron/main.ts`**：

```typescript
import { app, BrowserWindow, ipcMain } from 'electron'
import { join } from 'path'
import { registerFileIpc } from './ipc/file-ipc'
import { registerSearchIpc } from './ipc/search-ipc'
import { registerAgentIpc } from './ipc/agent-ipc'

function createWindow(): BrowserWindow {
  const win = new BrowserWindow({
    width: 1400,
    height: 900,
    titleBarStyle: 'hiddenInset', // macOS 原生风格
    webPreferences: {
      preload: join(__dirname, '../preload/index.js'),
      contextIsolation: true,
      nodeIntegration: false,
    },
  })

  if (process.env.NODE_ENV === 'development') {
    win.loadURL('http://localhost:5173')
    win.webContents.openDevTools()
  } else {
    win.loadFile(join(__dirname, '../renderer/index.html'))
  }

  return win
}

app.whenReady().then(() => {
  registerFileIpc(ipcMain)
  registerSearchIpc(ipcMain)
  registerAgentIpc(ipcMain)
  createWindow()
})

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit()
})
```

### Preload 安全桥接

**`electron/preload.ts`**：

```typescript
import { contextBridge, ipcRenderer } from 'electron'

contextBridge.exposeInMainWorld('electronAPI', {
  file: {
    readFile: (filePath: string) =>
      ipcRenderer.invoke('file:read', filePath),
    writeFile: (filePath: string, content: string) =>
      ipcRenderer.invoke('file:write', filePath, content),
    listDirectory: (dirPath: string) =>
      ipcRenderer.invoke('file:list-dir', dirPath),
    openDirectory: () =>
      ipcRenderer.invoke('file:open-dir-dialog'),
    watchFile: (filePath: string, callback: (content: string) => void) => {
      ipcRenderer.on(`file:changed:${filePath}`, (_, content) => callback(content))
      ipcRenderer.invoke('file:watch', filePath)
    },
  },
  search: {
    ripgrep: (query: string, dirPath: string) =>
      ipcRenderer.invoke('search:ripgrep', query, dirPath),
  },
  agent: {
    sendMessage: (message: string, sessionKey: string) =>
      ipcRenderer.invoke('agent:send', message, sessionKey),
    onStream: (callback: (chunk: string) => void) => {
      ipcRenderer.on('agent:stream-chunk', (_, chunk) => callback(chunk))
    },
  },
  platform: process.platform,
})
```

### 文件系统 IPC

**`electron/ipc/file-ipc.ts`**：

```typescript
import { IpcMain, dialog } from 'electron'
import { readFile, writeFile, readdir } from 'fs/promises'
import { FSWatcher, watch as fsWatch } from 'fs'
import { join, extname } from 'path'

const SUPPORTED_EXTENSIONS = new Set(['.md', '.txt', '.json', '.ts', '.js'])

export interface FileEntry {
  name: string
  path: string
  isDirectory: boolean
}

export function registerFileIpc(ipcMain: IpcMain): void {
  ipcMain.handle('file:read', async (_, filePath: string) => {
    return readFile(filePath, 'utf-8')
  })

  ipcMain.handle('file:write', async (_, filePath: string, content: string) => {
    await writeFile(filePath, content, 'utf-8')
    return { success: true }
  })

  ipcMain.handle('file:list-dir', async (_, dirPath: string): Promise<FileEntry[]> => {
    const entries = await readdir(dirPath, { withFileTypes: true })
    const result: FileEntry[] = []

    for (const entry of entries) {
      if (entry.name.startsWith('.')) continue
      const fullPath = join(dirPath, entry.name)
      if (entry.isDirectory()) {
        result.push({ name: entry.name, path: fullPath, isDirectory: true })
      } else if (SUPPORTED_EXTENSIONS.has(extname(entry.name))) {
        result.push({ name: entry.name, path: fullPath, isDirectory: false })
      }
    }

    return result.sort((a, b) => {
      if (a.isDirectory !== b.isDirectory) return a.isDirectory ? -1 : 1
      return a.name.localeCompare(b.name)
    })
  })

  ipcMain.handle('file:open-dir-dialog', async () => {
    const result = await dialog.showOpenDialog({ properties: ['openDirectory'] })
    return result.canceled ? null : result.filePaths[0]
  })

  const watchers = new Map<string, FSWatcher>()

  ipcMain.handle('file:watch', async (event, filePath: string) => {
    if (watchers.has(filePath)) return
    const watcher = fsWatch(filePath, async () => {
      const content = await readFile(filePath, 'utf-8')
      event.sender.send(`file:changed:${filePath}`, content)
    })
    watchers.set(filePath, watcher)
  })
}
```

### ripgrep 全文搜索

**`electron/ipc/search-ipc.ts`**：

```typescript
import { IpcMain } from 'electron'
import { spawn } from 'child_process'
import { join } from 'path'
import { app } from 'electron'

export interface SearchResult {
  filePath: string
  lineNumber: number
  lineContent: string
  matchStart: number
  matchEnd: number
}

function getRipgrepPath(): string {
  // 打包后从 extraResources 读取，开发时使用系统安装的 rg
  return app.isPackaged ? join(process.resourcesPath, 'bin', 'rg') : 'rg'
}

export function registerSearchIpc(ipcMain: IpcMain): void {
  ipcMain.handle(
    'search:ripgrep',
    (_, query: string, dirPath: string): Promise<SearchResult[]> => {
      return new Promise((resolve, reject) => {
        const args = [
          '--json',
          '--smart-case',
          '--max-count', '50',
          '--glob', '*.md',
          '--glob', '*.txt',
          query,
          dirPath,
        ]

        const rg = spawn(getRipgrepPath(), args)
        const results: SearchResult[] = []
        let buffer = ''

        rg.stdout.on('data', (data: Buffer) => {
          buffer += data.toString()
          const lines = buffer.split('\n')
          buffer = lines.pop() ?? ''

          for (const line of lines) {
            if (!line.trim()) continue
            try {
              const parsed = JSON.parse(line)
              if (parsed.type === 'match') {
                const { path, lines: matchLines, line_number, submatches } = parsed.data
                results.push({
                  filePath: path.text,
                  lineNumber: line_number,
                  lineContent: matchLines.text.trimEnd(),
                  matchStart: submatches[0]?.start ?? 0,
                  matchEnd: submatches[0]?.end ?? 0,
                })
              }
            } catch {
              // skip unparseable lines
            }
          }
        })

        rg.on('close', () => resolve(results))
        rg.on('error', reject)
      })
    }
  )
}
```

### Agent IPC（复用现有）

**`electron/ipc/agent-ipc.ts`**：

```typescript
import { IpcMain, WebContents } from 'electron'
import { AgentService } from '../../src/agent/service.js'
import { loadConfig } from '../../src/config/index.js'

let agentService: AgentService | null = null

async function getOrCreateAgent(): Promise<AgentService> {
  if (agentService) return agentService
  const config = await loadConfig()
  agentService = new AgentService({
    workspace: config.agents?.defaults?.workspace ?? process.env.HOME ?? '.',
    model: config.agents?.defaults?.model ?? 'claude-3-5-sonnet',
  })
  await agentService.start()
  return agentService
}

export function registerAgentIpc(ipcMain: IpcMain): void {
  ipcMain.handle('agent:send', async (event, message: string, sessionKey: string) => {
    const agent = await getOrCreateAgent()
    const sender: WebContents = event.sender

    await agent.sendMessage(message, sessionKey, {
      onChunk: (chunk: string) => {
        sender.send('agent:stream-chunk', chunk)
      },
    })

    return { done: true }
  })
}
```

---

## 打包配置

**`electron-builder.yml`**（项目根目录）：

```yaml
appId: com.xopcai.xopcbot
productName: xopcbot
directories:
  output: dist/release

files:
  - dist/electron/**/*
  - package.json

# 将 ripgrep 二进制打入安装包
extraResources:
  - from: node_modules/@vscode/ripgrep/bin/
    to: bin/
    filter: ["rg", "rg.exe"]

mac:
  category: public.app-category.productivity
  icon: assets/icon.icns
  target:
    - dmg
    - zip

win:
  icon: assets/icon.ico
  target:
    - nsis

linux:
  target:
    - AppImage
    - deb
```

---

## 依赖清单

```bash
# Electron 核心（devDependencies）
pnpm add -D electron electron-vite electron-builder

# ripgrep 多平台二进制分发（devDependencies）
pnpm add -D @vscode/ripgrep

# 编辑器（web/ 子包）
pnpm add -C web @codemirror/state @codemirror/view @codemirror/commands
pnpm add -C web @codemirror/lang-markdown @codemirror/language-data
pnpm add -C web @codemirror/theme-one-dark @codemirror/autocomplete
pnpm add -C web @codemirror/language

# Markdown 解析与高亮（web/ 子包）
pnpm add -C web marked marked-highlight highlight.js

# 防抖（web/ 子包）
pnpm add -C web use-debounce
```

---

## 实现路线图

| 阶段 | 内容 | 预估工期 |
|------|------|----------|
| **P0 — 骨架** | electron-vite 接入 + 主进程骨架 + preload IPC 桥接 | 1 天 |
| **P1 — 编辑器** | 文件树组件 + CodeMirror 6 编辑器 + 自动保存 | 2 天 |
| **P2 — 搜索** | ripgrep 全文搜索 + 搜索结果面板 | 1 天 |
| **P3 — AI 集成** | Agent IPC 接入 + 编辑器内 AI 辅助写作 | 1 天 |
| **P4 — 打包** | electron-builder 多平台打包 + 代码签名 | 1 天 |

---

## 与现有项目的集成关系

| 现有能力 | Electron 复用方式 |
|----------|------------------|
| `src/agent/service.ts` | 主进程直接 `import`，无需重写 |
| `src/config/` | 主进程启动时加载，共享同一份 `~/.xopcbot/config.json` |
| `src/providers/index.ts` | 主进程侧直接使用，LLM 调用无需改动 |
| `web/` React UI | 作为 renderer，新增编辑器页面路由 |
| Zustand stores | 扩展 `file-tree-store`、`editor-store` |
| Tailwind + 设计系统 | 完全复用 `globals.css` 语义 token |
| `web/src/components/markdown/` | 统一 Markdown 组件，chat 和编辑器共用 |

> 详见 [统一 Markdown 组件系统](markdown-system.md)

---

_Last updated: 2026-03-27_
