import { Link } from 'react-router-dom';
import type { RuntimeStatus } from './runtime-tools-api';
export function RuntimeImpact({ statuses, zh }: { statuses: RuntimeStatus[]; zh: boolean }) {
  return <section className="mt-3 rounded-lg border border-edge p-3 text-sm text-fg-muted">
    <h3 className="font-medium text-fg">{zh ? '这些检查影响什么' : 'What these checks affect'}</h3>
    <p className="mt-1">{zh ? '这里只检查受管脚本环境。未安装不等于所有任务不可用；已有系统运行时可能仍可被具体工具使用。' : 'These checks cover managed script environments. Missing installations do not make all tasks unavailable; individual tools may use system runtimes.'}</p>
    <ul className="mt-2 space-y-1">{statuses.map(status => <li key={status.runtime}>{status.runtime}: {status.state === 'ready' ? (zh ? '受管环境就绪；具体任务仍需验证' : 'Managed runtime ready; verify the actual task') : (zh ? '需此环境的脚本尚未通过本项检查，可按需安装或修复' : 'Scripts requiring this runtime have not passed this check; install or repair when needed')}</li>)}</ul>
    <p className="mt-2">{zh ? '文档与数据任务按实际脚本选择 Python 或 Node；聊天与云手机请分别检查模型和设备连接。安装系统服务用于后台常驻，不代表模型连接已验证。' : 'Document and data tasks use Python or Node according to their scripts. Check model and device connections for chat and cloud phones. A system service keeps the app running in the background; it does not verify model access.'}</p>
    <div className="mt-2 flex gap-4"><Link className="text-accent" to="/settings/capabilities/models">{zh ? '检查模型' : 'Check models'}</Link><Link className="text-accent" to="/settings/phone-use">{zh ? '检查手机' : 'Check phones'}</Link></div>
  </section>;
}
