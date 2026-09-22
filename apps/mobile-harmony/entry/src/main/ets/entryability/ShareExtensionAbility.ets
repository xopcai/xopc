import { ShareExtensionAbility, UIExtensionContentSession, Want } from '@kit.AbilityKit';
import { systemShare } from '@kit.ShareKit';
import { hilog } from '@kit.PerformanceAnalysisKit';
import { encodeShareHandoff, incomingShare, SHARE_INTAKE_URI } from '../service/shareIntake';
import { XopcIncomingShare } from '../model/share';

export default class XopcShareExtensionAbility extends ShareExtensionAbility {
  onSessionCreate(want: Want, session: UIExtensionContentSession): void {
    session.loadContent('pages/ShareIntake');
    this.receive(want, session);
  }

  private async receive(want: Want, session: UIExtensionContentSession): Promise<void> {
    try {
      const shared = await systemShare.getSharedData(want);
      const values: string[] = [];
      let title: string = '';
      shared.getRecords().forEach((record: systemShare.SharedRecord): void => {
        if (!title && record.title) title = record.title;
        if (record.content) values.push(record.content);
        else if (record.uri?.startsWith('http://') || record.uri?.startsWith('https://')) values.push(record.uri);
      });
      const intake: XopcIncomingShare | undefined = incomingShare(title, values);
      if (intake) {
        await this.context.startAbility({
          bundleName: 'ai.xopc.mobile', abilityName: 'EntryAbility', uri: SHARE_INTAKE_URI,
          parameters: { xopcSharePayload: encodeShareHandoff(title, values) }
        });
      }
    } catch (error) {
      hilog.warn(0x0000, 'XopcShare', 'Inbound share could not be received: %{public}s', (error as Error).message);
    } finally {
      await session.terminateSelf();
    }
  }
}
