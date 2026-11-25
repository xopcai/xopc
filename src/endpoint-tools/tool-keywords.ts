import { BROWSER_CONTROL_ENDPOINT_TOOL_NAME } from '@xopcai/browser-control-contract';
import { REMOTE_BROWSER_CONTROL_TOOL } from '@xopcai/browser-control-contract/remote';
import { COMPUTER_CONTROL_TOOL, REMOTE_COMPUTER_CONTROL_TOOL } from '@xopcai/computer-control-contract';
import type { EndpointKind } from '@xopcai/endpoint-tools-protocol';

import type { EndpointConnectionSnapshot } from './registry.js';

const INTERNAL_CONTROL_TOOLS = new Set<string>([
  BROWSER_CONTROL_ENDPOINT_TOOL_NAME,
  REMOTE_BROWSER_CONTROL_TOOL,
  COMPUTER_CONTROL_TOOL,
  REMOTE_COMPUTER_CONTROL_TOOL,
]);

const MAX_CONTEXT_CAPABILITIES = 24;

const KIND_KEYWORDS: Record<EndpointKind, string> = {
  mobile: 'phone mobile 手机 移动端',
  desktop: 'desktop computer mac pc 电脑 桌面',
  web: 'web browser tab 网页 浏览器',
  browser: 'browser extension tab 浏览器 插件',
  bridge: 'bridge hardware sensor device 硬件 传感器 桥接',
};

const TOOL_KEYWORD_RULES: ReadonlyArray<readonly [RegExp, string]> = [
  [/\.device\.get_location$/, 'location gps weather nearby 位置 定位 天气 附近'],
  [/\.device\.get_power$/, 'battery power charging level 电量 电池 充电'],
  [/\.device\.get_(?:state|info)$/, 'device info state status model os 设备 信息 状态 系统'],
  [/^mobile\.calendar\.query_events$/, 'calendar events schedule agenda 日历 日程 安排 行程'],
  [/^mobile\.calendar\.query_free_busy$/, 'calendar free busy availability schedule 空闲 忙碌 日历 时间'],
  [/^mobile\.calendar\.create_event$/, 'calendar create add event schedule 新建日程 创建日程 添加日历'],
  [/^mobile\.contacts\.(?:pick|find_by_name|search|get)$/, 'contacts phone number email address book 联系人 通讯录 电话 手机号 邮箱'],
  [/^mobile\.media\.list_recent$/, 'photos recent gallery album pictures images 最近照片 相册 照片 图片'],
  [/^mobile\.media\.read_image$/, 'photo image read view picture gallery 读取照片 查看照片 图片 相册'],
  [/^mobile\.media\.pick$/, 'photo image pick select gallery 选择照片 相册 图片'],
  [/^mobile\.media\.add_to_album$/, 'photo album organize move add 整理相册 添加到相册 归类照片'],
  [/^mobile\.camera\.capture$/, 'camera take photo capture picture 拍照 相机 拍一张'],
  [/\.file\.pick$/, 'file document pick select upload 选择文件 文件 文档'],
  [/\.file\.(?:save|download)$/, 'file save download 保存文件 下载文件'],
  [/\.file\.share$/, 'file share 分享文件 共享'],
  [/^desktop\.screen\.capture$/, 'screenshot screen capture display 截图 截屏 屏幕'],
  [/\.clipboard\.(?:read|write)$/, 'clipboard copy paste text 剪贴板 复制 粘贴'],
  [/\.notification\.show$/, 'notification alert remind 通知 提醒'],
  [/^desktop\.folder\./, 'folder files directory local workspace 文件夹 本地文件 目录'],
  [/^desktop\.(?:command\.run|terminal\.)/, 'command terminal shell run 终端 命令'],
  [/\.app\.open_/, 'open url app link 打开链接 打开应用'],
];

/** Bilingual capability keywords for BM25 tool_search recall across English and Chinese queries. */
export function deviceToolKeywords(toolName: string, kind?: EndpointKind): string {
  const parts: string[] = [];
  for (const [pattern, keywords] of TOOL_KEYWORD_RULES) {
    if (pattern.test(toolName)) {
      parts.push(keywords);
      break;
    }
  }
  if (kind && KIND_KEYWORDS[kind]) {
    parts.push(KIND_KEYWORDS[kind]);
  }
  return parts.join(' ');
}

/** Bounded list of user-facing device tool names advertised by a source endpoint. */
export function summarizeEndpointCapabilities(
  endpoint: Pick<EndpointConnectionSnapshot, 'tools'>,
): string[] {
  const names = new Set<string>();
  for (const tool of endpoint.tools) {
    const name = tool.descriptor.name;
    if (!INTERNAL_CONTROL_TOOLS.has(name)) {
      names.add(name);
    }
  }
  return [...names].sort().slice(0, MAX_CONTEXT_CAPABILITIES);
}
