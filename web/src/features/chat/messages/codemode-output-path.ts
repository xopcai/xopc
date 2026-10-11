export function codemodeOutputPath(text: string): string | undefined {
  return /^Full Codemode output: (\.xopc\/codemode-output\/[a-f0-9-]{36}\.txt)(?:\r?\n|$)/.exec(text)?.[1];
}
