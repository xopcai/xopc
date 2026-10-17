# Loopi 原生悬浮窗验证

日期：2026-10-17。平台：本机 macOS、Electron 42.4.1、Retina 显示器。

## 验证范围

使用 `scripts/verify-desktop-pet-native.mts` 启动真正的透明 BrowserWindow，直接复用生产的窗口管理、preload、IPC handler 和 `/desktop-pet` 页面。使用编译后的 Web 静态产物，避免其他开发改动触发 HMR 干扰。状态通过真实 IPC 对应的生产服务注入本地测试事件，不触发 LLM 请求。

应用状态和自定义宠物目录均隔离在系统临时目录；没有向真实会话写入验证任务，也未修改用户的桌宠偏好。自动化时使用独立应用标识的本地 Electron 副本，以免与已运行的桌面端混淆。此验证覆盖原生桌宠，不等于完整安装包、Gateway 或多平台发布验收。

## 结果与修复

| 项目 | 结果 |
| --- | --- |
| 待机 | 圆环和白色核心正常，轻呼吸、眨眼正常 |
| 工作 | 工作卡片与专注表情正常，气泡展开时保持底部锚点 |
| 等待确认 | 看向用户并持续停留，原生气泡有确认入口 |
| 完成 | 笑眼与单次轻弹正常，随后保留完成表情 |
| 鼠标拖拽 | 实际鼠标拖动移动原生窗口；释放恢复任务状态 |
| 松开落点 | 最终复测窗口从 `(0, 33)` 移至 `(70, 68)`，保存的右下锚点为 `(490, 326)`；未触发打开主界面 |
| 左上边界 | 修复前窗口 x 可到 `-140`，气泡左侧裁切；修复后完整气泡窗口限制在 `(0, 33)`，尺寸 `420×258` |
| 角色尺寸 | 70%、100%、140% 均检查了原生角色和气泡 |

修复内容：

1. 原来只用角色的 interactiveSize 限制拖动边界，改为使用完整 contentSize，包括展开气泡。内容尺寸变化时，先更新尺寸再钳制锚点；在屏幕中央仍保持原锚点，在边缘必要时让完整窗口回到可见区域。
2. 拖拽阈值改用 screenX/screenY，避免移动原生窗口后 clientX/clientY 不变而漏掉移动。
3. 鼠标松开时补交最终屏幕坐标，以应对合并/丢失 pointermove；依据松开点判断是否拖动，抑制拖拽结束后的误点击。
4. 补充窗口级 pointerup/pointercancel、失焦和丢失捕获的结束处理，重复结束事件不会重复保存。

回归测试：`src/pets/__tests__/native-window.test.ts` 覆盖完整气泡边界、尺寸变化和落点持久化；`web/src/features/desktop-pet/__tests__/desktop-pet-drag.test.tsx` 覆盖局部坐标不变、窗口级松开、丢失移动事件和误点击。全部宠物相关测试共 34 项通过，Web 构建与相关 ESLint 检查通过。

截图保存在 `assets/brand/loopi/native-validation/`，包括待机、工作、默认尺寸等待确认、完成与边界修复前后对照。窗口截图中的白色区域是截图合成背景。

## 重复验证

先构建 Web 与 Electron preload，再在一个本地端口提供 `dist/gateway/static/root` 的静态内容。

```sh
pnpm --dir web run build
pnpm run electron:vite:build:package
pnpm exec esbuild scripts/verify-desktop-pet-native.mts --bundle --platform=node --format=esm --external:electron --outfile=out/main/pet-native-validation.js
XOPC_PET_RENDERER_URL=http://127.0.0.1:8767/ pnpm exec electron out/main/pet-native-validation.js
```

原生菜单“验证”：Cmd+1 重载至待机，Cmd+2 工作，Cmd+3 等待确认，Cmd+4 完成；Cmd+5 输出保存位置；Cmd+6/7/8 设置 70%/100%/140%；Cmd+9 通过生产拖拽服务复测左上边界。真实鼠标拖拽另行操作，不能用边界菜单替代鼠标交互验证。

尚未覆盖 Windows、多显示器跨屏、不同系统缩放和完整安装包。
