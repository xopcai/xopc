/** Server-owned targeting rules; device descriptors cannot change these defaults. */
export function deviceCapabilityTarget(toolName: string): 'turn_origin' | 'session_bound' {
  if (/^(mobile|desktop|web|browser)\.device\./.test(toolName)
    || toolName === 'web.page.get_selection') return 'turn_origin';
  return 'session_bound';
}
