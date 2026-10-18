import { describe, it, expect } from '@ohos/hypium';
import { Driver, ON, abilityDelegatorRegistry } from '@kit.TestKit';
import { ComponentContent, window } from '@kit.ArkUI';
import { XopcChatRow } from '../../../main/ets/model/chat';
import { XopcChatMessageContent } from '../../../main/ets/view/ChatMessageContent';
import { reduceChatStream } from '../../../main/ets/common/chatStream';

@ComponentV2
struct WaitingReplyFixture {
  @Local row: XopcChatRow = { id: 'waiting-fixture', role: 'assistant', text: '', live: true,
    blocks: [{ id: 'notice', kind: 'text', text: '正在核对开放时间和预约要求。', presentation: 'narration' }] };
  @Local connection: string = 'connected';
  private startedAt: number = Date.now() - 11000;
  build() {
    Column({ space: 16 }) {
      Text('移动端回复展示验证').fontSize(20)
      Button('开始生成答案').id('waiting-fixture-draft').onClick((): void => {
        this.row = reduceChatStream(this.row, 'assistant_delta',
          { messageId: 'answer', delta: '## 今日可去\n\n已经核实开放时间。请出发前确认预约。', offset: 0 }, 'fixture');
      })
      Button('确认正式答案').id('waiting-fixture-answer').onClick((): void => {
        this.row = reduceChatStream(this.row, 'assistant_message_end', { messageId: 'answer', presentation: 'answer' }, 'fixture');
      })
      Button('完成回复').id('waiting-fixture-finish').onClick((): void => {
        this.row = reduceChatStream(this.row, 'run_end', { status: 'completed' }, 'fixture');
      })
      Button('连接中断').id('waiting-fixture-reconnect').onClick((): void => { this.connection = 'disconnected'; })
      XopcChatMessageContent({ row: this.row, runStartedAtMs: this.startedAt, connection: this.connection, animateStreaming: true })
    }.width('92%').padding(24).backgroundColor($r('app.color.surface')).borderRadius(24)
  }
}

@Builder
function waitingReplyBuilder() { WaitingReplyFixture() }

export default function waitingReplyTest(): void {
  describe('XopcWaitingReply', (): void => {
    it('separatesWaitingNarrationDraftAndConfirmedAnswer', 0, async (): Promise<void> => {
      const delegator = abilityDelegatorRegistry.getAbilityDelegator();
      const driver = Driver.create();
      await delegator.startAbility({ bundleName: delegator.getAppContext().applicationInfo.name, abilityName: 'EntryAbility' });
      await driver.delayMs(1000);
      const ui = (await window.getLastWindow((await delegator.getCurrentTopAbility()).context)).getUIContext();
      const content = new ComponentContent(ui, wrapBuilder(waitingReplyBuilder));
      await ui.getPromptAction().openCustomDialog(content, { autoCancel: false });
      try {
        await driver.waitForComponent(ON.id('chat-waiting-dots-waiting-fixture'), 5000);
        await driver.waitForComponent(ON.text('正在核对开放时间和预约要求。'), 5000);
        expect(await driver.findComponent(ON.id('chat-steps-waiting-fixture'))).assertNull();
        expect(await driver.screenCap(delegator.getAppContext().filesDir + '/waiting-reply-dots.png')).assertTrue();
        const dots = await driver.findComponent(ON.id('chat-waiting-dots-waiting-fixture'));
        const bounds = await dots.getBounds();
        expect(Math.abs((bounds.right - bounds.left) / (bounds.bottom - bounds.top) - 104 / 64) < 0.03).assertTrue();
        for (let frame = 0; frame < 12; frame++) {
          await driver.delayMs(100);
          expect(await driver.screenCap(delegator.getAppContext().filesDir + '/waiting-motion-frame-' + frame.toString() + '.png')).assertTrue();
        }
        await (await driver.findComponent(ON.id('waiting-fixture-reconnect'))).click();
        await driver.waitForComponent(ON.text('连接中断 · 正在恢复…'), 5000);
        expect(await driver.findComponent(ON.id('chat-waiting-dots-waiting-fixture'))).assertNull();
        await (await driver.findComponent(ON.id('waiting-fixture-draft'))).click();
        expect(await driver.findComponent(ON.text('今日可去'))).assertNull();
        await (await driver.findComponent(ON.id('waiting-fixture-answer'))).click();
        await driver.waitForComponent(ON.text('今日可去'), 5000);
        expect(await driver.findComponent(ON.id('chat-waiting-waiting-fixture'))).assertNull();
        await (await driver.findComponent(ON.id('waiting-fixture-finish'))).click();
        await driver.delayMs(1000);
        await driver.waitForComponent(ON.text('已经核实开放时间。请出发前确认预约。'), 5000);
        expect(await driver.screenCap(delegator.getAppContext().filesDir + '/waiting-reply-answer.png')).assertTrue();
      } finally { await ui.getPromptAction().closeCustomDialog(content); content.dispose(); }
    }, 30000);
  });
}
