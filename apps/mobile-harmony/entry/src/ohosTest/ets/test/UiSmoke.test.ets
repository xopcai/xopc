import { describe, it, expect } from '@ohos/hypium';
import { Driver, ON, abilityDelegatorRegistry } from '@kit.TestKit';

export default function uiSmokeTest(): void {
  describe('XopcUiSmoke', (): void => {
    it('rejectsInvalidPairingAndSwitchesPreferences', 0, async (): Promise<void> => {
      const driver = Driver.create();
      await abilityDelegatorRegistry.getAbilityDelegator().startAbility({ bundleName: 'ai.xopc.mobile', abilityName: 'EntryAbility' });
      await driver.waitForComponent(ON.id('connect-title'), 10000);
      await (await driver.findComponent(ON.id('pairing-manual'))).click();
      const input = await driver.findComponent(ON.id('pairing-link'));
      await input.inputText('https://invalid.example/not-a-pairing-link');
      // Complete the emulator's keyboard first-run setup before running UI tests.
      await driver.pressBack();
      await driver.waitForComponent(ON.id('pairing-connect'), 5000);
      await (await driver.findComponent(ON.id('pairing-connect'))).click();
      const error = await driver.waitForComponent(ON.id('pairing-error'), 5000);
      expect((await error.getText()).length > 0).assertTrue();
      await (await driver.findComponent(ON.id('open-settings'))).click();
      await driver.waitForComponent(ON.id('settings-title'), 5000);
      await (await driver.findComponent(ON.id('open-language'))).click();
      await (await driver.findComponent(ON.id('language-zh'))).click();
      await (await driver.findComponent(ON.id('preference-back'))).click();
      await (await driver.findComponent(ON.id('open-appearance'))).click();
      await (await driver.findComponent(ON.id('theme-dark'))).click();
      const screenshot = abilityDelegatorRegistry.getAbilityDelegator().getAppContext().filesDir + '/xopc-harmony-settings.png';
      expect(await driver.screenCap(screenshot)).assertTrue();
      await (await driver.findComponent(ON.id('preference-back'))).click();
      await (await driver.findComponent(ON.id('open-language'))).click();
      await (await driver.findComponent(ON.id('language-en'))).click();
      await (await driver.findComponent(ON.id('preference-back'))).click();
      await (await driver.findComponent(ON.id('open-appearance'))).click();
      await (await driver.findComponent(ON.id('theme-system'))).click();
      await (await driver.findComponent(ON.id('preference-back'))).click();
      await (await driver.findComponent(ON.id('settings-back'))).click();
      await driver.waitForComponent(ON.id('connect-title'), 5000);
      await (await driver.findComponent(ON.id('pairing-link'))).clearText();
      await driver.pressBack();
      await (await driver.findComponent(ON.id('pairing-back'))).click();
      await driver.waitForComponent(ON.id('pairing-scan'), 5000);
    }, 60000);
  });
}
