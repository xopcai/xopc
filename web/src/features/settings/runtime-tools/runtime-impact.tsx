import { Link } from 'react-router-dom';
import type { RuntimeStatus } from './runtime-tools-api';
export function RuntimeImpact({ statuses, zh }: { statuses: RuntimeStatus[]; zh: boolean }) {
  if (statuses.length === 0) return null;
  return <details className="mt-3 text-xs text-fg-muted">
    <summary className="w-fit cursor-pointer rounded focus-visible:outline-accent">{zh ? '关于运行环境' : 'About runtimes'}</summary>
    <p className="mt-2 leading-5">{zh ? '此处检测受管脚本环境；部分工具也可使用系统环境。聊天和手机控制需单独配置模型与设备。' : 'These checks cover managed script runtimes. Some tools can use system runtimes. Chat and phone control use separate model and device settings.'}</p>
    <div className="mt-2 flex gap-4"><Link className="text-accent" to="/settings/capabilities/models">{zh ? '检查模型' : 'Check models'}</Link><Link className="text-accent" to="/settings/phone-use">{zh ? '检查手机' : 'Check phones'}</Link></div>
  </details>;
}
