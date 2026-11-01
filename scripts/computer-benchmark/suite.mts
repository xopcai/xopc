export const WINDOWS_COMPUTER_BENCHMARK_VERSION = '1.1.0';
export const WINDOWS_COMPUTER_TASKS = [
  { id: 'replace', description: 'Replace a nonempty native field with exact Chinese/English text' },
  { id: 'append', description: 'Append Unicode, emoji and multiline text without losing the prefix' },
  { id: 'deduplicate', description: 'Replay an action envelope without a second button click' },
  { id: 'protected', description: 'Refuse password and readonly writes before native dispatch' },
  { id: 'stale', description: 'Refuse an old observation without input' },
  { id: 'owner', description: 'Refuse a foreign conversation without input' },
  { id: 'released', description: 'Refuse input after releasing the session' },
  { id: 'keyboard', description: 'Focus the intended editor and deliver End and Backspace' },
] as const;
export type WindowsComputerTaskId = typeof WINDOWS_COMPUTER_TASKS[number]['id'];
export const WINDOWS_COMPUTER_FRAMEWORKS = ['winforms', 'wpf'] as const;
export const normalizeNativeText = (value: string) => value.replaceAll('\r\n', '\n');
