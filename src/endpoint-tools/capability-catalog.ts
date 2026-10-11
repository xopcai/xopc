/** Server-owned targeting rules; device descriptors cannot change these defaults. */
export function deviceCapabilityTarget(toolName: string): 'turn_origin' | 'session_bound' {
  if (/^(mobile|desktop|web|browser)\.device\./.test(toolName)
    || /^(mobile|desktop|web)\.(file\.pick|media\.pick|camera\.capture|contacts\.(pick|search|get)|calendar\.query_(events|free_busy))$/.test(toolName)
    || toolName === 'desktop.clipboard.read'
    || toolName === 'web.page.get_selection') return 'turn_origin';
  return 'session_bound';
}
