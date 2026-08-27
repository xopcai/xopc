export interface RankedCandidateChannel {
  weight: number;
  ids: string[];
}

export function fuseRankedCandidates(
  channels: RankedCandidateChannel[],
  rankConstant = 60,
): Map<string, number> {
  const activeChannels = channels.filter((channel) => channel.weight > 0 && channel.ids.length > 0);
  if (!activeChannels.length) return new Map();
  const maximum = activeChannels.reduce((sum, channel) => sum + channel.weight / (rankConstant + 1), 0);
  const scores = new Map<string, number>();
  for (const channel of activeChannels) {
    const seen = new Set<string>();
    channel.ids.forEach((id, index) => {
      if (!id || seen.has(id)) return;
      seen.add(id);
      const contribution = channel.weight / (rankConstant + index + 1);
      scores.set(id, (scores.get(id) ?? 0) + contribution);
    });
  }
  for (const [id, score] of scores) scores.set(id, score / maximum);
  return scores;
}
