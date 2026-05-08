/**
 * Synapse 设置面板
 */
import { createExtensionClient } from '@xopcai/extension-ui-sdk';

async function main() {
  const client = createExtensionClient();
  await client.whenReady();

  const theme = await client.theme.getTheme();
  const dark = theme.mode === 'dark';
  document.documentElement.style.background = dark ? '#1c1c1e' : '#f5f5f7';
  document.documentElement.style.color = dark ? '#f5f5f7' : '#111';
  document.documentElement.style.fontFamily = '-apple-system,BlinkMacSystemFont,"SF Pro Text","PingFang SC","Segoe UI",Roboto,sans-serif';
  document.documentElement.style.padding = '16px';
  document.documentElement.style.fontSize = '13px';

  document.body.innerHTML = `
    <h2 style="font-size:15px;font-weight:700;margin-bottom:12px;">Synapse 设置</h2>
    <p style="color:#888;margin-bottom:16px;font-size:12px;">看板行为和演示模式配置。</p>

    <label style="display:flex;align-items:center;gap:8px;margin-bottom:12px;cursor:pointer;">
      <input type="checkbox" id="demoMode" checked style="width:16px;height:16px;">
      <span>启用演示模式（模拟数据）</span>
    </label>

    <label style="display:flex;align-items:center;gap:8px;margin-bottom:12px;cursor:pointer;">
      <input type="checkbox" id="autoAdvance" checked style="width:16px;height:16px;">
      <span>演示模式下自动推进进度</span>
    </label>

    <button style="margin-top:8px;padding:8px 16px;border-radius:8px;border:1px solid #d0d0d0;background:#fff;cursor:pointer;font-size:13px;"
      onclick="alert('设置已保存（演示）')">保存设置</button>

    <hr style="margin:20px 0;border:none;border-top:1px solid #e0e0e0;">

    <h3 style="font-size:13px;font-weight:600;margin-bottom:8px;">关于</h3>
    <p style="color:#888;font-size:12px;line-height:1.6;">
      Synapse 是一个 xopc 扩展，将人 × AI Agent 协作以看板形式呈现。<br>
      后端 Tool 注册将在后续版本中支持真实 Agent 驱动。
    </p>
  `;

  client.ui.resize(document.body.scrollHeight + 24);
}

main().catch(e => {
  document.body.innerHTML = `<pre style="padding:16px;color:#c00;">${String(e)}</pre>`;
});
