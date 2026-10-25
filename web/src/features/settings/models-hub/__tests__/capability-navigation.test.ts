import { expect, it } from 'vitest';
import { capabilityReturnPath, modelCapabilityPath, withCapabilityReturnContext } from '../capability-navigation';
it('uses one canonical page and a modal command for capability configuration',()=>{
  expect(modelCapabilityPath('speech',true)).toBe('/settings/capabilities/models?configure=speech&tab=services');
});
it.each(['/chat/test?mode=voice','/personal'])('preserves the internal return destination %s',returnTo=>{
  const url=new URL(withCapabilityReturnContext(modelCapabilityPath('transcription'),new URLSearchParams({returnTo})),'https://example.test');
  expect(url.searchParams.get('returnTo')).toBe(returnTo);
  expect(url.searchParams.has('from')).toBe(false);
});
it('does not forward external return destinations',()=>{
  expect(withCapabilityReturnContext(modelCapabilityPath('speech'),new URLSearchParams({returnTo:'https://example.test'}))).toBe(modelCapabilityPath('speech'));
});

it.each(['/settings/phone-use', '/automations?projectId=sample'])('retains the task context for %s', path => {
  expect(capabilityReturnPath(path)).toBe(path);
});
it.each(['//evil.example', '/settings/phone-use\\evil', 'javascript:alert(1)'])('rejects unsafe return paths %s', path => {
  expect(capabilityReturnPath(path)).toBeUndefined();
});
