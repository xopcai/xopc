import { describe, it, expect } from '@ohos/hypium';
import { Driver, ON, abilityDelegatorRegistry } from '@kit.TestKit';
import { ComponentContent, window } from '@kit.ArkUI';
import { XopcMathMarkdownView, MathMeasurement } from '../../../main/ets/view/MathMarkdownView';
import { XopcMarkdownView } from '../../../main/ets/view/MarkdownView';

const REWARD = '\\[\\mathcal{R}_{syn}(s_T;g)\\triangleq\\mathbf{1}\\big[V_g(s_T)=\\mathrm{True}\\big]\\]';

@ComponentV2
struct MathFixture {
  @Local source: string = REWARD;
  @Local streaming: boolean = false;
  @Local status: string = '';
  @Local overBudget: boolean = false;
  build() {
    Column({ space: 16 }) {
      Text(this.status).id('math-status')
      if (this.overBudget) {
        Scroll() { XopcMarkdownView({ content: (REWARD + '\n\n').repeat(257).trim() }) }.height(200)
      } else {
      XopcMathMarkdownView({ content: this.source, streaming: this.streaming,
        onMeasured: (value: MathMeasurement): void => {
          this.status = `${value.ready}:${value.pending}:${value.fontsLoaded}`;
        } })
      }
      Button('Pending').id('math-pending').onClick((): void => {
        this.streaming = true; this.source = '\\[\\frac{1}{';
      })
      Button('Complete').id('math-complete').onClick((): void => {
        this.source = REWARD; this.streaming = false;
      })
      Button('Budget').id('math-budget').onClick((): void => { this.overBudget = true; })
    }.width('95%').padding(20).backgroundColor($r('app.color.surface'))
  }
}

@Builder
function mathFixtureBuilder() { MathFixture() }

export default function mathMarkdownTest(): void {
  describe('XopcMathMarkdown', (): void => {
    it('rendersOfflineFontsAndCompletesStreamingFormula', 0, async (): Promise<void> => {
      const delegator = abilityDelegatorRegistry.getAbilityDelegator();
      const driver = Driver.create();
      await delegator.startAbility({ bundleName: 'ai.xopc.xopc', abilityName: 'EntryAbility' });
      await driver.waitForComponent(ON.id('connect-title'), 10000);
      const ui = (await window.getLastWindow((await delegator.getCurrentTopAbility()).context)).getUIContext();
      const content = new ComponentContent(ui, wrapBuilder(mathFixtureBuilder));
      await ui.getPromptAction().openCustomDialog(content, { autoCancel: false });
      try {
        await driver.waitForComponent(ON.text('1:0:true'), 15000);
        expect(await driver.screenCap(delegator.getAppContext().filesDir + '/math-rendered.png')).assertTrue();
        await (await driver.findComponent(ON.id('math-pending'))).click();
        await driver.waitForComponent(ON.text('0:1:true'), 10000);
        await (await driver.findComponent(ON.id('math-complete'))).click();
        await driver.waitForComponent(ON.text('1:0:true'), 10000);
        await (await driver.findComponent(ON.id('math-budget'))).click();
        await driver.waitForComponent(ON.text(REWARD), 10000);
      } finally { await ui.getPromptAction().closeCustomDialog(content); content.dispose(); }
    }, 60000);
  });
}
