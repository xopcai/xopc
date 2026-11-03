export type UsageTarget = { name: string; id: string; kind: 'mcp' | 'plugin' | 'connector' };

/** Open an editable introduction without copying remote tool descriptions into chat. */
export function connectionUsagePath(target: UsageTarget, zh: boolean) {
  const draft = zh
    ? `我想了解怎么用「${target.name}」。请简单介绍它能帮我做什么，以及我需要提供哪些信息。只介绍这个服务目前支持的用法，先不用帮我操作。`
    : `How can I use “${target.name}”? Briefly explain what it can help me do and what information I need to provide. Only describe what this service currently supports; don’t take any actions yet.`;
  return `/chat/new?${new URLSearchParams({ draft, projectScope: 'none' })}`;
}
