import { describe, expect, it } from '@ohos/hypium';
import { Driver, ON, abilityDelegatorRegistry } from '@kit.TestKit';
import { ComponentContent, window } from '@kit.ArkUI';
import { discussionCapture } from '../../../main/ets/service/discussionCapture';
import { XopcDiscussionRecordingPanelView } from '../../../main/ets/view/DiscussionRecordingPanel';
import { XopcDiscussionRecordingPanel } from '../../../main/ets/viewmodel/discussionRecordingPanel';

@ComponentV2
struct XopcRecordingPanelFixture {
  @Local panel: XopcDiscussionRecordingPanel = new XopcDiscussionRecordingPanel();
  @Local viewportWidth: number = 0;
  @Local viewportHeight: number = 0;

  aboutToAppear(): void { discussionCapture.phase = 'starting'; }
  aboutToDisappear(): void {
    discussionCapture.phase = 'idle';
    discussionCapture.savedDurationMs = 0;
    discussionCapture.backgroundAvailable = false;
    discussionCapture.transcriptPending = false;
    discussionCapture.syncStatus = 'pending';
    discussionCapture.reset();
  }

  build() {
    Stack({ alignContent: Alignment.Top }) {
      Column() {
        Button('Confirm microphone').id('fixture-recording-start').onClick((): void => {
          discussionCapture.phase = 'recording';
          discussionCapture.inputConfirmed = true;
          discussionCapture.backgroundAvailable = true;
          discussionCapture.elapsedMs = 1000;
        })
        Button('Update recording').id('fixture-recording-update').onClick((): void => {
          discussionCapture.level = 0.8;
          discussionCapture.elapsedMs = 2000;
          discussionCapture.transcriptPending = true;
        })
        Button('Simulate local save').id('fixture-recording-save').onClick((): void => {
          discussionCapture.phase = 'completed';
          discussionCapture.savedDurationMs = 2000;
          discussionCapture.localSaveComplete = true;
          discussionCapture.syncStatus = 'uploading';
        })
      }
      if (this.viewportWidth > 0 && this.viewportHeight > 0 && !this.panel.dismissed) {
        XopcDiscussionRecordingPanelView({
          panel: this.panel, viewportWidth: this.viewportWidth, viewportHeight: this.viewportHeight, docked: true
        })
      }
    }.width('100%').height('90%')
      .onAreaChange((_previous: Area, current: Area): void => {
        this.viewportWidth = Number(current.width);
        this.viewportHeight = Number(current.height);
      })
  }
}

@Builder
function recordingPanelFixtureBuilder() { XopcRecordingPanelFixture() }

export default function discussionRecordingPanelTest(): void {
  describe('XopcDiscussionRecordingPanel', (): void => {
    it('updates mounted controls, anchors recording content and lets the user dismiss after saving', 0, async (): Promise<void> => {
      const delegator = abilityDelegatorRegistry.getAbilityDelegator();
      const driver = Driver.create();
      await delegator.startAbility({ bundleName: 'ai.xopc.xopc', abilityName: 'EntryAbility' });
      expect((await driver.waitForComponent(ON.id('connect-title'), 10000)) !== null).assertTrue();
      const ui = (await window.getLastWindow((await delegator.getCurrentTopAbility()).context)).getUIContext();
      const content = new ComponentContent(ui, wrapBuilder(recordingPanelFixtureBuilder));
      await ui.getPromptAction().openCustomDialog(content, { autoCancel: false });
      try {
        const mark = ON.id('capture-float-mark');
        const pause = ON.id('capture-float-pause');
        const finish = ON.id('capture-float-finish');
        const save = ON.id('capture-float-save');
        await driver.waitForComponent(finish, 5000);
        expect(await (await driver.findComponent(finish)).isEnabled()).assertFalse();
        await (await driver.findComponent(ON.id('fixture-recording-start'))).click();
        expect(await (await driver.findComponent(mark)).isEnabled()).assertTrue();
        expect(await (await driver.findComponent(pause)).isEnabled()).assertTrue();
        expect(await (await driver.findComponent(finish)).isEnabled()).assertTrue();
        const before = await (await driver.findComponent(save)).getBounds();
        await (await driver.findComponent(ON.id('fixture-recording-update'))).click();
        expect((await (await driver.findComponent(save)).getBounds()).top).assertEqual(before.top);
        await (await driver.findComponent(pause)).click();
        expect(await (await driver.findComponent(mark)).isEnabled()).assertFalse();
        await (await driver.findComponent(pause)).click();
        expect(discussionCapture.phase).assertEqual('recording');
        await (await driver.findComponent(ON.id('fixture-recording-save'))).click();
        const later = await driver.waitForComponent(ON.id('capture-outcome-later'), 5000);
        await later.click();
        expect(await driver.findComponent(ON.id('discussion-recording-float'))).assertNull();
      } finally { await ui.getPromptAction().closeCustomDialog(content); content.dispose(); }
    }, 60000);
  });
}
