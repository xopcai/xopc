import { describe, expect, it } from 'vitest';
import { productNotificationActivationRoute, productNotificationToastXml } from '../../../electron/product-notification-activation.js';

describe('persisted native notification activation', () => {
  it('escapes the native toast text and target without introducing XML elements', () => {
    const xml = productNotificationToastXml({ title: 'A < B & "C"', body: '</text><actions/>', silent: true,
      target: { kind: 'automation_run', automationId: 'a&b', runId: 'original' } });
    expect(xml).toContain('A &lt; B &amp; &quot;C&quot;');
    expect(xml).not.toContain('<actions/>');
    expect(xml).toContain('<audio silent="true"/>');
    expect(xml).toContain('&quot;runId&quot;:&quot;original&quot;');
  });
  it.each(['not-json', '{}', 'null', '{"xopcNotification":1,"target":{"kind":"automation_run","automationId":"task"}}', 'x'.repeat(8193)])('ignores invalid activation payloads', input => {
    expect(productNotificationActivationRoute(input)).toBeNull();
  });
});
