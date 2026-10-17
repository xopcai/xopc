import { describe, it, expect } from '@ohos/hypium';
import { Driver, ON, abilityDelegatorRegistry } from '@kit.TestKit';
import { ComponentContent, window } from '@kit.ArkUI';
import { XopcChartMarkdownView } from '../../../main/ets/view/ChartMarkdownView';

const CHART_FIXTURE = '{"version":1,"type":"line","title":"离线图表","summary":"缺失值和负数","dataKind":"example",' +
  '"xAxis":{"label":"月份","values":["一月","二月","三月"]},"yAxis":{"label":"金额","unit":"元"},' +
  '"series":[{"name":"甲","values":[1,null,-2]},{"name":"乙","values":[-3,0,2]}]}';

@ComponentV2
struct XopcChartTestFixture {
  @Local source: string = CHART_FIXTURE;
  @Local closed: boolean = false;
  @Local status: string = 'pending';
  build() {
    Column({ space: 8 }) {
      Text(this.status).id('chart-fixture-status')
      XopcChartMarkdownView({ content: this.source, closed: this.closed,
        onRendered: (success: boolean): void => { this.status = success ? 'ready' : 'invalid'; } })
      Button('Complete').id('chart-fixture-complete').onClick((): void => { this.closed = true; })
      Button('Bar').id('chart-fixture-bar').onClick((): void => {
        this.status = 'pending'; this.source = CHART_FIXTURE.replace('"line"', '"bar"');
      })
      Button('Invalid').id('chart-fixture-invalid').onClick((): void => { this.status = 'pending'; this.source = '{}'; })
    }.width('95%').padding(12).backgroundColor($r('app.color.surface'))
  }
}

@Builder
function chartFixtureBuilder() { XopcChartTestFixture() }

export default function chartMarkdownTest(): void {
  describe('XopcChartMarkdown', (): void => {
    it('rendersOfflineLineAndBarAfterCompletionAndRejectsInvalidData', 0, async (): Promise<void> => {
      const delegator = abilityDelegatorRegistry.getAbilityDelegator();
      const driver = Driver.create();
      await delegator.startAbility({ bundleName: 'ai.xopc.xopc', abilityName: 'EntryAbility' });
      await driver.waitForComponent(ON.id('connect-title'), 10000);
      const ui = (await window.getLastWindow((await delegator.getCurrentTopAbility()).context)).getUIContext();
      const content = new ComponentContent(ui, wrapBuilder(chartFixtureBuilder));
      await ui.getPromptAction().openCustomDialog(content, { autoCancel: false });
      try {
        await driver.waitForComponent(ON.text('等待图表数据完成…'), 10000);
        await (await driver.findComponent(ON.id('chart-fixture-complete'))).click();
        await driver.waitForComponent(ON.text('ready'), 15000);
        expect(await driver.screenCap(delegator.getAppContext().filesDir + '/chart-line.png')).assertTrue();
        await (await driver.findComponent(ON.id('chart-fixture-bar'))).click();
        await driver.waitForComponent(ON.text('ready'), 15000);
        expect(await driver.screenCap(delegator.getAppContext().filesDir + '/chart-bar.png')).assertTrue();
        await (await driver.findComponent(ON.id('chart-fixture-invalid'))).click();
        await driver.waitForComponent(ON.text('invalid'), 10000);
      } finally { await ui.getPromptAction().closeCustomDialog(content); content.dispose(); }
    }, 60000);
  });
}
