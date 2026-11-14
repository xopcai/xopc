export const browserFallbackCases = [
  {
    id: 'loyalty',
    service: 'Northstar Rewards',
    label: 'Show points balance',
    resultLabel: 'Available points',
    value: 624831,
    first: '帮我查一下 Northstar Rewards 账户的可用积分。',
    followUp: '是查我自己的余额，直接给我结果。我的账户入口是 {url}',
  },
  {
    id: 'support',
    service: 'Harbor Desk',
    label: 'Show open tickets',
    resultLabel: 'Open support tickets',
    value: 73,
    first: 'Can you check how many open tickets I have in my Harbor Desk account?',
    followUp: 'Yes, please get the count for my workspace. My account portal is {url}',
  },
  {
    id: 'billing',
    service: 'Cedar Meter',
    label: 'View amount due',
    resultLabel: 'Amount due in dollars',
    value: 284672,
    first: '我想知道 Cedar Meter 账单还有多少美元没付。',
    followUp: '接着刚才那件事，查到金额就告诉我。账户首页是 {url}',
  },
] as const;
