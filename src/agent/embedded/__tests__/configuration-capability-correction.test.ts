import type { AgentMessage } from '@earendil-works/pi-agent-core';
import { expect, it } from 'vitest';

import { configurationCapabilityCorrection as correct } from '../configuration-capability-correction.js';

it.each([
  'I cannot connect because the required MCP setup tool is not available in this session.',
  '当前会话未提供 MCP 配置工具，请到设置页面添加。',
  '无法连接：该地址是本机回环地址 127.0.0.1，当前环境不可访问。',
])('corrects an unverified denial using actual registered capability facts: %s', answer => {
  const result = correct(['mcp_setup'], 'Connect http://127.0.0.1/mcp', answer, []);
  expect(result).toContain('directly callable');
  expect(result).toContain('grants no additional authorization');
  expect(result).toContain('honor any actual permission refusal');
});

it('does not invent a missing tool, alter ordinary replies or retry a genuine setup refusal', () => {
  const answer = 'The MCP setup tool is not available.';
  expect(correct([], 'Connect https://example.com/mcp', answer, [])).toBeUndefined();
  expect(correct(['mcp_setup'], 'Write a report', answer, [])).toBeUndefined();
  expect(correct(['mcp_setup'], 'Connect https://example.com/mcp', 'The server returned HTTP 404.', [])).toBeUndefined();
  const attempted = [{ role: 'assistant', content: [{ type: 'toolCall', name: 'mcp_setup', arguments: { command: 'start' } }] }] as unknown as AgentMessage[];
  expect(correct(['mcp_setup'], 'Connect https://example.com/mcp', answer, attempted)).toBeUndefined();
});

it('continues an explicitly authorized Skill install once when the model only promises action', () => {
  expect(correct(['skill_install'], '安装这个周报能力 https://example.com/report.zip，装好后汇总数据。', '我会先安装并启用该周报能力，然后整理金额。', []))
    .toContain('one bounded continuation');
  expect(correct(['skill_install'], '只推荐，不要安装 https://example.com/report.zip', '我会安装这个能力。', [])).toBeUndefined();
  expect(correct(['skill_install'], '安装这个能力 https://example.com/report.zip', '无法安装，权限被拒绝。', [])).toBeUndefined();
  expect(correct(['skill_install'], '安装这个能力 https://example.com/report.zip，但先不要安装，只检查。', '我会安装。', [])).toBeUndefined();
  expect(correct([], '安装这个能力 https://example.com/report.zip', '我会安装。', [])).toBeUndefined();
  expect(correct(['skill_install'], 'Translate: 安装这个能力 https://example.com/report.zip', '我会安装。', [])).toBeUndefined();
});

it.each(['周报', '日报', '销售报表'])('does not infer Skill installation from the business label %s alone', label => {
  expect(correct(['skill_install'], `安装这个${label} https://example.com/report.zip`, '我会安装。', [])).toBeUndefined();
  expect(correct(['skill_install'], `安装这个${label}技能 https://example.com/report.zip`, '我会安装。', [])).toContain('one bounded continuation');
});
