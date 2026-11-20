import { describe, it, expect } from '@ohos/hypium';
import { Driver, ON, abilityDelegatorRegistry } from '@kit.TestKit';

export default function uiSmokeTest(): void {
  describe('XopcUiSmoke', (): void => {
    it('returnsFromGatewayManagementAndPreferencesToPairingSettings', 0, async (): Promise<void> => {
      const driver = Driver.create();
      await abilityDelegatorRegistry.getAbilityDelegator().startAbility({ bundleName: 'ai.xopc.xopc', abilityName: 'EntryAbility' });
      const settings = ON.id('settings-gateways');
      await (await driver.waitForComponent(ON.id('open-settings'), 10000)).click();
      await (await driver.waitForComponent(settings, 5000)).click();
      await (await driver.waitForComponent(ON.id('gateways-back'), 5000)).click();
      await driver.delayMs(500);
      await (await driver.waitForComponent(settings, 5000)).click();
      await (await driver.waitForComponent(ON.id('gateways-add'), 5000)).click();
      expect(!!await driver.waitForComponent(ON.id('pairing-back'), 5000)).assertTrue();
      await driver.delayMs(500);
      await driver.pressBack();
      expect(!!await driver.waitForComponent(ON.id('gateways-title'), 5000)).assertTrue();
      await driver.pressBack();
      await driver.delayMs(500);
      await (await driver.waitForComponent(ON.id('open-appearance'), 5000)).click();
      expect(!!await driver.waitForComponent(ON.id('theme-system'), 5000)).assertTrue();
      await driver.delayMs(500);
      await driver.pressBack();
      expect(!!await driver.waitForComponent(settings, 5000)).assertTrue();
      await (await driver.findComponent(ON.id('settings-back'))).click();
      expect(!!await driver.waitForComponent(ON.id('pairing-scan'), 5000)).assertTrue();
    }, 60000);

    it('rejectsInvalidPairingAndSwitchesPreferences', 0, async (): Promise<void> => {
      const driver = Driver.create();
      await abilityDelegatorRegistry.getAbilityDelegator().startAbility({ bundleName: 'ai.xopc.xopc', abilityName: 'EntryAbility' });
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
      await driver.waitForComponent(ON.id('settings-gateways'), 5000);
      await (await driver.findComponent(ON.id('open-language'))).click();
      await (await driver.findComponent(ON.id('language-zh'))).click();
      await (await driver.findComponent(ON.id('settings-back'))).click();
      await (await driver.findComponent(ON.id('open-appearance'))).click();
      await (await driver.findComponent(ON.id('theme-dark'))).click();
      const screenshot = abilityDelegatorRegistry.getAbilityDelegator().getAppContext().filesDir + '/xopc-harmony-settings.png';
      expect(await driver.screenCap(screenshot)).assertTrue();
      await (await driver.findComponent(ON.id('settings-back'))).click();
      await (await driver.findComponent(ON.id('open-language'))).click();
      await (await driver.findComponent(ON.id('language-en'))).click();
      await (await driver.findComponent(ON.id('settings-back'))).click();
      await (await driver.findComponent(ON.id('open-appearance'))).click();
      await (await driver.findComponent(ON.id('theme-system'))).click();
      await (await driver.findComponent(ON.id('settings-back'))).click();
      await (await driver.findComponent(ON.id('settings-back'))).click();
      await driver.waitForComponent(ON.id('connect-title'), 5000);
      await (await driver.findComponent(ON.id('pairing-link'))).clearText();
      await driver.pressBack();
      await (await driver.findComponent(ON.id('pairing-back'))).click();
      await driver.waitForComponent(ON.id('pairing-scan'), 5000);
    }, 60000);
  });
}
