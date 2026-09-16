import { describe, it, expect } from '@ohos/hypium';
import { Driver, ON, abilityDelegatorRegistry } from '@kit.TestKit';

export default function uiSmokeTest(): void {
  describe('XopcUiSmoke', (): void => {
    it('rejectsInvalidPairingAndSwitchesPreferences', 0, async (): Promise<void> => {
      const driver = Driver.create();
      await abilityDelegatorRegistry.getAbilityDelegator().startAbility({ bundleName: 'ai.xopc.mobile', abilityName: 'EntryAbility' });
      await driver.waitForComponent(ON.id('connect-title'), 10000);
      const input = await driver.findComponent(ON.id('pairing-link'));
      await input.inputText('https://invalid.example/not-a-pairing-link');
      // Complete the emulator's keyboard first-run setup before running UI tests.
      await driver.pressBack();
      await driver.waitForComponent(ON.id('pairing-connect'), 5000);
      await (await driver.findComponent(ON.id('pairing-connect'))).click();
      const error = await driver.waitForComponent(ON.id('pairing-error'), 5000);
      expect(await error.getText()).assertEqual('INVALID_INVITATION');
      await (await driver.findComponent(ON.id('open-settings'))).click();
      await driver.waitForComponent(ON.id('settings-title'), 5000);
      await (await driver.findComponent(ON.id('language-zh'))).click();
      await driver.waitForComponent(ON.text('设置').id('settings-title'), 5000);
      await (await driver.findComponent(ON.id('theme-dark'))).click();
      const screenshot = abilityDelegatorRegistry.getAbilityDelegator().getAppContext().filesDir + '/xopc-harmony-settings.png';
      expect(await driver.screenCap(screenshot)).assertTrue();
      await (await driver.findComponent(ON.id('language-en'))).click();
      await driver.waitForComponent(ON.text('Settings').id('settings-title'), 5000);
      await (await driver.findComponent(ON.id('theme-system'))).click();
      await (await driver.findComponent(ON.id('settings-back'))).click();
      await driver.waitForComponent(ON.id('connect-title'), 5000);
      await (await driver.findComponent(ON.id('pairing-link'))).clearText();
    }, 60000);
  });
}
