import { describe, it, expect } from '@ohos/hypium';
import { Driver, ON, abilityDelegatorRegistry } from '@kit.TestKit';
import { ComponentContent, window } from '@kit.ArkUI';
import { XopcChatRow, XopcProductDelivery } from '../../../main/ets/model/chat';
import { XopcChatMessageContent } from '../../../main/ets/view/ChatMessageContent';
import { historyRows } from '../../../main/ets/common/chatProtocol';
import { mergeAssistantRows, refreshChatRow } from '../../../main/ets/common/chatRichContent';
import { reduceChatStream } from '../../../main/ets/common/chatStream';
import { encodeBase64Url } from '../../../main/ets/common/protocol';
import { fileIo as fs } from '@kit.CoreFileKit';

interface FixtureArgs { row: XopcChatRow; }
interface ReadInput { path: string; }
interface ProductDetails { delivery: XopcProductDelivery; }

@ComponentV2
struct RichChatFixture {
  @Param initial: XopcChatRow = { id: '', role: 'assistant', text: '' };
  @Local row: XopcChatRow = { id: '', role: 'assistant', text: '' };
  @Local draft: string = '';
  aboutToAppear(): void { this.row = this.initial; }
  build() {
    Column({ space: 12 }) {
      Text('Chat fixture').fontSize(18).fontColor($r('app.color.foreground'))
      if (this.draft) { Text(this.draft).id('fixture-draft').fontSize(14).fontColor($r('app.color.foreground')) }
      Button('Refresh snapshot').id('fixture-refresh').onClick((): void => {
        const updated = JSON.parse(JSON.stringify(this.row)) as XopcChatRow;
        const call = updated.blocks?.find((block): boolean => block.call?.id === 'read')?.call;
        if (call) call.result = 'Reference updated.';
        this.row = refreshChatRow(updated);
      })
      if (this.row.live) {
        Button('Complete fixture run').id('fixture-complete').onClick((): void => {
          let row = reduceChatStream(this.row, 'command_output_delta', { toolCallId: 'cmd', delta: 'Command failed safely.' }, 'fixture');
          row = reduceChatStream(row, 'command_completed', { toolCallId: 'cmd', exitCode: 1 }, 'fixture');
          row = reduceChatStream(row, 'assistant_delta', { messageId: 'final', delta: 'Partial answer retained.' }, 'fixture');
          this.row = reduceChatStream(row, 'run_end', { status: 'cancelled' }, 'fixture');
        })
      }
      Scroll() {
        XopcChatMessageContent({ row: this.row, conversationId: 'fixture-only', reasoning: 'on', onFillDraft: (text: string): void => { this.draft = text; } })
      }.id('fixture-scroll').width('100%').layoutWeight(1)
    }.id('rich-chat-fixture').width('95%').height('85%').padding(16).backgroundColor($r('app.color.surface'))
  }
}

@Builder
function fixtureBuilder(args: FixtureArgs) { RichChatFixture({ initial: args.row }) }

function executionRow(): XopcChatRow {
  return mergeAssistantRows(historyRows({ session: { key: 'fixture', messages: [
    { id: 'rich', role: 'assistant', content: [{ type: 'thinking', thinking: 'Inspect references before editing.' },
      { type: 'toolCall', id: 'read', name: 'read_file', input: { path: 'README.md' } as ReadInput }] },
    { role: 'toolResult', toolCallId: 'read', content: 'Reference loaded.' },
    { id: 'answer', role: 'assistant', content: '## Completed\nCore scenarios are aligned.\n\n| Scenario | Result |\n| --- | --- |\n| History | Passed |' }
  ] }, pagination: { hasMore: false } }))[0];
}

function silentWav(): string {
  const samples = 8000 * 8;
  const bytes = new Uint8Array(44 + samples * 2);
  const header = new DataView(bytes.buffer);
  bytes.set([82, 73, 70, 70], 0); header.setUint32(4, bytes.length - 8, true);
  bytes.set([87, 65, 86, 69, 102, 109, 116, 32], 8); header.setUint32(16, 16, true);
  header.setUint16(20, 1, true); header.setUint16(22, 1, true); header.setUint32(24, 8000, true);
  header.setUint32(28, 16000, true); header.setUint16(32, 2, true); header.setUint16(34, 16, true);
  bytes.set([100, 97, 116, 97], 36); header.setUint32(40, samples * 2, true);
  return 'data:audio/wav;base64,' + encodeBase64Url(bytes);
}

export default function richChatTest(): void {
  describe('XopcRichChat', (): void => {
    it('preservesExpandedStepsAndToolDetailsAcrossSnapshotReplacement', 0, async (): Promise<void> => {
      const delegator = abilityDelegatorRegistry.getAbilityDelegator();
      const driver = Driver.create();
      await delegator.startAbility({ bundleName: 'ai.xopc.mobile', abilityName: 'EntryAbility' });
      await driver.waitForComponent(ON.id('connect-title'), 10000);
      const ui = (await window.getLastWindow((await delegator.getCurrentTopAbility()).context)).getUIContext();
      const content = new ComponentContent(ui, wrapBuilder(fixtureBuilder), { row: executionRow() } as FixtureArgs);
      await ui.getPromptAction().openCustomDialog(content, { autoCancel: false });
      try {
        await (await driver.waitForComponent(ON.id('chat-steps-rich'), 5000)).click();
        await (await driver.waitForComponent(ON.id('chat-tool-read'), 5000)).click();
        await driver.waitForComponent(ON.text('Reference loaded.'), 5000);
        await (await driver.findComponent(ON.id('fixture-refresh'))).click();
        await driver.waitForComponent(ON.text('Reference updated.'), 5000);
        expect(await driver.screenCap(delegator.getAppContext().filesDir + '/rich-chat-steps.png')).assertTrue();
      } finally { await ui.getPromptAction().closeCustomDialog(content); content.dispose(); }
    }, 30000);
    it('offersCapabilityGatedProductActionsAndFillsAnUnsentDraft', 0, async (): Promise<void> => {
      const delegator = abilityDelegatorRegistry.getAbilityDelegator(); const driver = Driver.create();
      const ui = (await window.getLastWindow((await delegator.getCurrentTopAbility()).context)).getUIContext();
      const details: ProductDetails = { delivery: { version: 1, operation: 'created', primary: {
        kind: 'note', id: 'fixture-note', title: 'Fixture note', summary: 'A saved result', capabilities: ['continue_in_chat', 'share'] } } };
      const row: XopcChatRow = { id: 'product', role: 'assistant', text: 'Created a note.', toolCalls: [{ id: 'tool', name: 'xopc_use', status: 'done', details }] };
      const content = new ComponentContent(ui, wrapBuilder(fixtureBuilder), { row } as FixtureArgs);
      await ui.getPromptAction().openCustomDialog(content, { autoCancel: false });
      try {
        await driver.waitForComponent(ON.id('chat-product-share-fixture-note'), 5000);
        await (await driver.waitForComponent(ON.id('chat-product-continue-fixture-note'), 5000)).click();
        const draft = await driver.waitForComponent(ON.id('fixture-draft'), 5000);
        expect(await draft.getText()).assertContain('Fixture note'); expect(await draft.getText()).assertContain('fixture-note');
        expect(await driver.screenCap(delegator.getAppContext().filesDir + '/rich-chat-product.png')).assertTrue();
      } finally { await ui.getPromptAction().closeCustomDialog(content); content.dispose(); }
    }, 30000);
    it('updatesLiveToolOutputAndRetainsPartialAnswerAfterCancellation', 0, async (): Promise<void> => {
      const delegator = abilityDelegatorRegistry.getAbilityDelegator(); const driver = Driver.create();
      const ui = (await window.getLastWindow((await delegator.getCurrentTopAbility()).context)).getUIContext();
      let row = reduceChatStream(undefined, 'thinking_delta', { delta: 'Live thinking' }, 'fixture');
      row = reduceChatStream(row, 'command_started', { toolCallId: 'cmd', command: 'fixture-command' }, 'fixture');
      const content = new ComponentContent(ui, wrapBuilder(fixtureBuilder), { row } as FixtureArgs);
      await ui.getPromptAction().openCustomDialog(content, { autoCancel: false });
      try {
        await (await driver.waitForComponent(ON.id('chat-steps-live:fixture'), 5000)).click();
        await (await driver.waitForComponent(ON.id('chat-tool-cmd'), 5000)).click();
        await (await driver.findComponent(ON.id('fixture-complete'))).click();
        await driver.waitForComponent(ON.text('Command failed safely.'), 5000);
        await driver.waitForComponent(ON.text('Partial answer retained.'), 5000);
        expect(await driver.screenCap(delegator.getAppContext().filesDir + '/rich-chat-live.png')).assertTrue();
      } finally { await ui.getPromptAction().closeCustomDialog(content); content.dispose(); }
    }, 30000);
    it('rendersReviewAndUnavailableDeliverablesWithoutNetwork', 0, async (): Promise<void> => {
      const delegator = abilityDelegatorRegistry.getAbilityDelegator(); const driver = Driver.create();
      const ui = (await window.getLastWindow((await delegator.getCurrentTopAbility()).context)).getUIContext();
      const row = historyRows({ session: { key: 'fixture', messages: [{ id: 'review', role: 'assistant', content: [], metadata: {
        review: { type: 'review', summary: 'Review summary', overallCorrectness: 'patch is incorrect', findings: [
          { title: 'Handle cancellation', body: 'Keep the partial answer after cancellation.', priority: 1, filePath: 'chat.ets', lineStart: 42 }] },
        turnOutcome: { version: 1, outcomeId: 'o', runId: 'r', turnId: 't', status: 'partial', deliverables: [
          { artifactId: 'expired', title: 'expired.png', kind: 'image', availability: 'expired' },
          { artifactId: 'pending', title: 'report.pdf', kind: 'file', availability: 'materializing' }] }
      } }] }, pagination: { hasMore: false } })[0];
      const content = new ComponentContent(ui, wrapBuilder(fixtureBuilder), { row } as FixtureArgs);
      await ui.getPromptAction().openCustomDialog(content, { autoCancel: false });
      try {
        await driver.waitForComponent(ON.text('P1 · Handle cancellation'), 5000);
        await driver.waitForComponent(ON.id('chat-artifact-expired'), 5000);
        await driver.waitForComponent(ON.id('chat-artifact-pending'), 5000);
        expect(await driver.screenCap(delegator.getAppContext().filesDir + '/rich-chat-review.png')).assertTrue();
      } finally { await ui.getPromptAction().closeCustomDialog(content); content.dispose(); }
    }, 30000);
    it('playsAndPausesHistoricalAudioAndCleansItsOwnedCache', 0, async (): Promise<void> => {
      const delegator = abilityDelegatorRegistry.getAbilityDelegator(); const driver = Driver.create();
      const context = (await delegator.getCurrentTopAbility()).context;
      const ui = (await window.getLastWindow(context)).getUIContext();
      const previous = (await fs.listFile(context.cacheDir)).filter((name: string): boolean => name.startsWith('chat-media-'));
      const row = historyRows({ session: { key: 'fixture', messages: [{ id: 'audio', role: 'assistant', content: '',
        ttsAudio: { uri: silentWav(), mimeType: 'audio/wav', name: 'Silent test.wav' } }] }, pagination: { hasMore: false } })[0];
      const content = new ComponentContent(ui, wrapBuilder(fixtureBuilder), { row } as FixtureArgs);
      await ui.getPromptAction().openCustomDialog(content, { autoCancel: false });
      try {
        await (await driver.waitForComponent(ON.id('chat-preview-audio:audio:0'), 5000)).click();
        await driver.waitForComponent(ON.id('chat-media-duration'), 10000);
        await (await driver.findComponent(ON.id('chat-media-play'))).click();
        await driver.waitForComponent(ON.id('chat-media-pause'), 5000);
        await driver.delayMs(1800);
        expect(await driver.screenCap(context.filesDir + '/rich-chat-audio-playing.png')).assertTrue();
        expect(await (await driver.findComponent(ON.id('chat-media-position'))).getText() !== '0:00').assertTrue();
        await (await driver.findComponent(ON.id('chat-media-pause'))).click();
        await driver.waitForComponent(ON.id('chat-media-play'), 5000);
        expect(await driver.screenCap(context.filesDir + '/rich-chat-audio.png')).assertTrue();
        await (await driver.findComponent(ON.id('chat-media-close'))).click();
        let remaining: string[] = [];
        for (let attempt = 0; attempt < 15; attempt++) {
          remaining = (await fs.listFile(context.cacheDir)).filter((name: string): boolean => name.startsWith('chat-media-'));
          if (remaining.length === previous.length) break;
          await driver.delayMs(200);
        }
        expect(remaining.sort().join(',')).assertEqual(previous.sort().join(','));
      } finally { await ui.getPromptAction().closeCustomDialog(content); content.dispose(); }
    }, 30000);
    it('previewsEmbeddedTextWithoutExecutingMarkup', 0, async (): Promise<void> => {
      const delegator = abilityDelegatorRegistry.getAbilityDelegator(); const driver = Driver.create();
      const ui = (await window.getLastWindow((await delegator.getCurrentTopAbility()).context)).getUIContext();
      const row: XopcChatRow = { id: 'text', role: 'user', text: '', media: [{ id: 'text-file', name: 'report.txt', type: 'document', mimeType: 'text/plain', size: 5,
        uri: 'data:text/plain;base64,SGVsbG8=' }] };
      const content = new ComponentContent(ui, wrapBuilder(fixtureBuilder), { row } as FixtureArgs);
      await ui.getPromptAction().openCustomDialog(content, { autoCancel: false });
      try {
        await (await driver.waitForComponent(ON.id('chat-preview-text-file'), 5000)).click();
        expect(await (await driver.waitForComponent(ON.id('chat-media-text'), 5000)).getText()).assertEqual('Hello');
        await (await driver.findComponent(ON.id('chat-media-close'))).click();
      } finally { await ui.getPromptAction().closeCustomDialog(content); content.dispose(); }
    }, 30000);
    it('decodesEmbeddedImagesAndOpensPreviewWithoutGatewayCredentials', 0, async (): Promise<void> => {
      const delegator = abilityDelegatorRegistry.getAbilityDelegator(); const driver = Driver.create();
      const ui = (await window.getLastWindow((await delegator.getCurrentTopAbility()).context)).getUIContext();
      const row: XopcChatRow = { id: 'image', role: 'assistant', text: 'Image preview', outcome: { version: 1, outcomeId: 'o', runId: 'r', turnId: 't', status: 'succeeded', deliverables: [
        { artifactId: 'embedded', title: 'pixel.png', kind: 'image', mimeType: 'image/png', availability: 'available',
          uri: 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aKj8AAAAASUVORK5CYII=' }
      ] } };
      const content = new ComponentContent(ui, wrapBuilder(fixtureBuilder), { row } as FixtureArgs);
      await ui.getPromptAction().openCustomDialog(content, { autoCancel: false });
      try {
        await (await driver.waitForComponent(ON.id('chat-image-embedded'), 10000)).click();
        await driver.waitForComponent(ON.id('chat-media-preview'), 5000);
        expect(await driver.screenCap(delegator.getAppContext().filesDir + '/rich-chat-image.png')).assertTrue();
        await (await driver.findComponent(ON.id('chat-media-close'))).click();
      } finally { await ui.getPromptAction().closeCustomDialog(content); content.dispose(); }
    }, 30000);
  });
}
