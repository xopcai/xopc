import { ShareExtensionAbility, UIExtensionContentSession, Want } from '@kit.AbilityKit';
import { systemShare } from '@kit.ShareKit';
import { hilog } from '@kit.PerformanceAnalysisKit';
import { encodeShareHandoff, incomingShare, SHARE_INTAKE_URI } from '../service/shareIntake';
import { XopcIncomingShare, XopcIncomingShareAttachment } from '../model/share';
import { fileIo as fs, fileUri } from '@kit.CoreFileKit';
import { util } from '@kit.ArkTS';
import { attachmentMime } from '../common/attachments';

export default class XopcShareExtensionAbility extends ShareExtensionAbility {
  onSessionCreate(want: Want, session: UIExtensionContentSession): void {
    session.loadContent('pages/ShareIntake');
    this.receive(want, session);
  }

  private async receive(want: Want, session: UIExtensionContentSession): Promise<void> {
    const attachments: XopcIncomingShareAttachment[] = [];
    try {
      const shared = await systemShare.getSharedData(want);
      const values: string[] = [];
      let title: string = '';
      const records = shared.getRecords();
      for (const record of records) {
        if (!title && record.title) title = record.title;
        if (record.content) values.push(record.content);
        else if (record.uri?.startsWith('http://') || record.uri?.startsWith('https://')) values.push(record.uri);
        else if (record.uri) {
          const source = await fs.open(record.uri, fs.OpenMode.READ_ONLY);
          try {
            const size = (await fs.stat(source.fd)).size;
            if (size <= 0 || size > 8 * 1024 * 1024) continue;
            const original = new fileUri.FileUri(record.uri).name || 'attachment';
            const safeName = original.replace(/[\\/]/g, '_');
            const path = this.context.filesDir + '/share-' + util.generateRandomUUID() + '-' + safeName;
            const destination = await fs.open(path, fs.OpenMode.CREATE | fs.OpenMode.WRITE_ONLY);
            try { await fs.copyFile(source.fd, destination.fd); }
            finally { await fs.close(destination); }
            attachments.push({ path, name: safeName, mimeType: attachmentMime(safeName), size });
          } finally { await fs.close(source); }
        }
      }
      const intake: XopcIncomingShare | undefined = incomingShare(title, values, attachments);
      if (intake) {
        await this.context.startAbility({
          bundleName: 'ai.xopc.xopc', abilityName: 'EntryAbility', uri: SHARE_INTAKE_URI,
          parameters: { xopcSharePayload: encodeShareHandoff(title, values, attachments) }
        });
      }
    } catch (error) {
      for (const item of attachments) { try { await fs.unlink(item.path); } catch (_cleanupError) {} }
      hilog.warn(0x0000, 'XopcShare', 'Inbound share could not be received: %{public}s', (error as Error).message);
    } finally {
      await session.terminateSelf();
    }
  }
}
