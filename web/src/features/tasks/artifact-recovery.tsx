import { useState } from 'react';
import { Link } from 'react-router-dom';
import { Button } from '@/components/ui/button';
import { extendShare, fetchShares, type ShareItem } from '@/features/shares/shares-api';

export function matchArtifactShare(uri: string, shares: ShareItem[]): ShareItem | undefined {
  let target: URL;
  try { target = new URL(uri); } catch { return undefined; }
  return shares.find(share => [share.shareUrl, share.lanUrl].some(value => {
    if (!value) return false;
    try { const candidate = new URL(value); return candidate.origin === target.origin && candidate.pathname.replace(/\/$/, '') === target.pathname.replace(/\/$/, ''); }
    catch { return false; }
  }));
}

export function ArtifactRecovery({ uri, zh }: { uri: string; zh: boolean }) {
  const [share, setShare] = useState<ShareItem>();
  const [busy, setBusy] = useState(false);
  const [checked, setChecked] = useState(false);
  const [message, setMessage] = useState('');
  const [url, setUrl] = useState('');
  async function check() {
    setBusy(true); setMessage('');
    try {
      const found = matchArtifactShare(uri, (await fetchShares()).payload.shares);
      setShare(found); setChecked(true);
      if (!found) setMessage(zh ? '未找到本机管理的分享记录。外部链接或已清理的记录无法在这里续期，请从原任务重新生成产物。' : 'No locally managed share matches this link. Regenerate the artifact from its task.');
      else if (found.kind !== 'file' && found.kind !== 'directory') setMessage(zh ? '这是文档快照，请从原笔记或对话的分享面板重新发布。' : 'This is a document snapshot. Republish it from the original note or conversation.');
      else if (found.revoked) setMessage(zh ? '分享已被撤销，不能自动恢复。请从原任务重新生成并分享。' : 'This share was revoked. Generate and share a new artifact from the task.');
      else if (found.maxViews !== null && found.downloadCount >= found.maxViews) setMessage(zh ? '已达到访问次数上限，请在分享设置中调整后重试。' : 'The access limit was reached. Adjust it in share settings.');
      else if (!found.expired) { setUrl(found.shareUrl); setMessage(zh ? '链接仍在有效期内；若打不开，请检查网关连接。' : 'The link has not expired. If it cannot open, check gateway connectivity.'); }
    } catch { setMessage(zh ? '检查失败，请重试。' : 'Check failed. Please retry.'); }
    finally { setBusy(false); }
  }
  async function renew() {
    if (!share || busy) return;
    setBusy(true); setMessage('');
    try {
      const result = await extendShare(share.id, 86_400_000);
      setUrl(result.payload.shareUrl); setShare({ ...share, expired: false, expiresAt: result.payload.expiresAt });
      setMessage(zh ? '已续期 24 小时，访问范围与次数限制保持不变。' : 'Renewed for 24 hours. Access scope and view limits are unchanged.');
    } catch (error) { setMessage(`${zh ? '恢复失败：' : 'Recovery failed: '}${error instanceof Error ? error.message : String(error)}`); }
    finally { setBusy(false); }
  }
  return <details className="mt-2 text-xs text-fg-muted"><summary className="cursor-pointer py-2">{zh ? '链接打不开？' : 'Trouble opening the link?'}</summary>
    <div className="space-y-2"><Button type="button" variant="ghost" disabled={busy} onClick={() => void check()}>{zh ? '检查链接状态' : 'Check link'}</Button>
      {checked && share?.expired && (share.kind === 'file' || share.kind === 'directory') && !share.revoked && (share.maxViews === null || share.downloadCount < share.maxViews) && <Button type="button" disabled={busy} onClick={() => void renew()}>{zh ? '恢复链接 · 续期 24 小时' : 'Restore link for 24 hours'}</Button>}
      {message && <p role="status" className="break-words leading-5">{message}</p>}
      {url && <a className="block py-2 text-accent" href={url} target="_blank" rel="noopener noreferrer">{zh ? '打开产物' : 'Open artifact'}</a>}
      {checked && <Link className="block py-2 text-accent" to="/settings/shares">{zh ? '管理分享记录' : 'Manage shares'}</Link>}
    </div>
  </details>;
}
