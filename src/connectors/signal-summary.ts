import type { KnowledgeSourceItem } from '../knowledge/types.js';
import { clusterUnderstandingSignals, type UnderstandingSignal } from '../user-context/sources/signal-clustering.js';
import type { UnderstandingConsentReceipt, UnderstandingSourceItem } from '../user-context/sources/types.js';

const DAY_MS = 86_400_000;
const CALENDAR_PAST_WINDOW_DAYS = 180;
const CALENDAR_FUTURE_WINDOW_DAYS = 60;
const DEFAULT_WINDOW_DAYS = 180;
const MAX_BACKING_REFS = 40;
const WEEKDAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'] as const;

type JsonRecord = Record<string, unknown>;

export interface ConnectorSignalSummaryResult {
  toolkit: string;
  sourceId: string;
  summaryItem?: UnderstandingSourceItem;
  backingEvidenceRefs: string[];
  ownerBackedEvidenceRefs: string[];
  metrics: {
    totalItems: number;
    ownerItems: number;
    distinctOwnerDates: number;
    recurringSeries?: number;
    collaborators?: number;
    topicClusters?: number;
  };
}

function asRecord(value: unknown): JsonRecord {
  return value && typeof value === 'object' && !Array.isArray(value) ? value as JsonRecord : {};
}

function parseNormalized(item: KnowledgeSourceItem): JsonRecord {
  if (!item.normalizedText) return {};
  try {
    return asRecord(JSON.parse(item.normalizedText) as unknown);
  } catch {
    return {};
  }
}

function str(value: unknown): string | undefined {
  return typeof value === 'string' && value.trim() ? value.trim() : undefined;
}

function timestampMs(value: string | undefined): number | undefined {
  if (!value) return undefined;
  const parsed = Date.parse(value);
  return Number.isFinite(parsed) ? parsed : undefined;
}

function itemTimestamp(item: KnowledgeSourceItem): number | undefined {
  return timestampMs(item.occurredAt) ?? timestampMs(item.sourceUpdatedAt);
}

function itemTitle(item: KnowledgeSourceItem, value: JsonRecord): string {
  return str(value.title) ?? str(value.subject) ?? str(value.fullName) ?? str(value.repository) ?? item.itemType;
}

function timeBucket(ts: number): 'morning' | 'afternoon' | 'evening' | 'night' {
  const hour = new Date(ts).getHours();
  if (hour >= 6 && hour < 12) return 'morning';
  if (hour >= 12 && hour < 18) return 'afternoon';
  if (hour >= 18 && hour < 23) return 'evening';
  return 'night';
}

function normalizeTitleKey(title: string): string {
  return title
    .toLocaleLowerCase()
    .replace(/^(re|fwd|fw|回复|转发)\s*[:：]\s*/gi, '')
    .replace(/\b\d{4}[-/.]\d{1,2}(?:[-/.]\d{1,2})?\b/g, '')
    .replace(/[^\p{L}\p{N}]+/gu, ' ')
    .trim();
}

function extractOwnerIdentities(items: KnowledgeSourceItem[]): Set<string> {
  const owners = new Set<string>();
  for (const item of items) {
    const list = Array.isArray(item.metadata.ownerIdentities) ? item.metadata.ownerIdentities : [];
    for (const value of list) {
      if (typeof value === 'string' && value.trim()) owners.add(value.trim().toLowerCase());
    }
    const selfEmail = str(item.metadata.selfEmail);
    if (selfEmail) owners.add(selfEmail.toLowerCase());
  }
  return owners;
}

function personDisplay(entry: unknown): { key: string; label: string; isSelf: boolean } | undefined {
  if (typeof entry === 'string' && entry.trim()) {
    const raw = entry.trim();
    const emailMatch = /<([^<>\s]+@[^<>\s]+)>/.exec(raw);
    const email = emailMatch?.[1]?.toLowerCase() ?? (raw.includes('@') ? raw.toLowerCase() : undefined);
    const label = emailMatch ? raw.replace(emailMatch[0], '').replace(/["']/g, '').trim() || email! : raw;
    return { key: (email ?? label).toLowerCase(), label: label.slice(0, 80), isSelf: false };
  }
  const row = asRecord(entry);
  const email = str(row.email) ?? str(row.emailAddress);
  const name = str(row.displayName) ?? str(row.name) ?? str(row.username) ?? str(row.login);
  const key = (email ?? name)?.toLowerCase();
  if (!key) return undefined;
  return {
    key,
    label: (name ?? email ?? key).slice(0, 80),
    isSelf: row.self === true,
  };
}

function selectRepresentativeRefs(items: KnowledgeSourceItem[]): {
  backingEvidenceRefs: string[];
  ownerBackedEvidenceRefs: string[];
  distinctOwnerDates: number;
} {
  const ownerDates = new Set<string>();
  const ownerRefs: string[] = [];
  const otherRefs: string[] = [];
  const seenOwnerDate = new Set<string>();

  const sorted = [...items].sort((left, right) => (itemTimestamp(right) ?? 0) - (itemTimestamp(left) ?? 0));
  for (const item of sorted) {
    const ref = `knowledge-source://${item.id}`;
    const ts = itemTimestamp(item);
    const dateKey = ts !== undefined ? new Date(ts).toISOString().slice(0, 10) : undefined;
    if (item.metadata.actorAttributed === true) {
      if (dateKey) ownerDates.add(dateKey);
      // Prioritize spanning distinct dates first so durable evidence sees true multi-day spread.
      if (dateKey && !seenOwnerDate.has(dateKey)) {
        seenOwnerDate.add(dateKey);
        ownerRefs.unshift(ref);
      } else {
        ownerRefs.push(ref);
      }
    } else {
      otherRefs.push(ref);
    }
  }
  const ownerBackedEvidenceRefs = ownerRefs.slice(0, MAX_BACKING_REFS);
  const backingEvidenceRefs = [...ownerBackedEvidenceRefs, ...otherRefs].slice(0, MAX_BACKING_REFS);
  return { backingEvidenceRefs, ownerBackedEvidenceRefs, distinctOwnerDates: ownerDates.size };
}

function summarizeCalendar(
  items: KnowledgeSourceItem[],
  allowed: Set<string>,
  nowMs: number,
): { payload: JsonRecord; recurringSeries: number; collaborators: number } {
  const minTs = nowMs - CALENDAR_PAST_WINDOW_DAYS * DAY_MS;
  const maxTs = nowMs + CALENDAR_FUTURE_WINDOW_DAYS * DAY_MS;
  const owners = extractOwnerIdentities(items);

  type SeriesAcc = {
    title: string;
    count: number;
    organizerCount: number;
    attendeeCounts: number[];
    weekdays: Map<string, number>;
    buckets: Map<string, number>;
    latestTs: number;
  };
  const series = new Map<string, SeriesAcc>();
  const weekdayCounts = new Map<string, number>();
  const bucketCounts = new Map<string, number>();
  const collaboratorCounts = new Map<string, { label: string; count: number; topics: Set<string> }>();
  const upcoming: Array<{ title: string; date: string; attendees: number }> = [];
  let inWindowCount = 0;

  for (const item of items) {
    if (item.metadata.declined === true || item.metadata.automated === true) continue;
    const value = parseNormalized(item);
    const ts = itemTimestamp(item);
    if (ts !== undefined && (ts < minTs || ts > maxTs)) continue;
    inWindowCount += 1;
    const title = itemTitle(item, value);
    const attendees = Array.isArray(value.attendees) ? value.attendees : [];
    const organizer = personDisplay(value.organizer);
    const isOrganizer = Boolean(organizer && (organizer.isSelf || owners.has(organizer.key)));

    if (ts !== undefined && allowed.has('timestamps')) {
      const weekday = WEEKDAYS[new Date(ts).getDay()]!;
      const bucket = timeBucket(ts);
      weekdayCounts.set(weekday, (weekdayCounts.get(weekday) ?? 0) + 1);
      bucketCounts.set(bucket, (bucketCounts.get(bucket) ?? 0) + 1);
    }

    const seriesKey = str(value.recurringEventId) || normalizeTitleKey(title);
    if (seriesKey && allowed.has('title')) {
      const current = series.get(seriesKey) ?? {
        title,
        count: 0,
        organizerCount: 0,
        attendeeCounts: [],
        weekdays: new Map(),
        buckets: new Map(),
        latestTs: 0,
      };
      current.count += 1;
      if (isOrganizer) current.organizerCount += 1;
      if (attendees.length) current.attendeeCounts.push(attendees.length);
      if (ts !== undefined) {
        const weekday = WEEKDAYS[new Date(ts).getDay()]!;
        const bucket = timeBucket(ts);
        current.weekdays.set(weekday, (current.weekdays.get(weekday) ?? 0) + 1);
        current.buckets.set(bucket, (current.buckets.get(bucket) ?? 0) + 1);
        current.latestTs = Math.max(current.latestTs, ts);
      }
      series.set(seriesKey, current);
    }

    if (allowed.has('participants') && attendees.length >= 2 && attendees.length <= 8) {
      for (const rawAttendee of attendees) {
        const person = personDisplay(rawAttendee);
        if (!person || person.isSelf || owners.has(person.key)) continue;
        const entry = collaboratorCounts.get(person.key) ?? { label: person.label, count: 0, topics: new Set<string>() };
        entry.count += 1;
        if (allowed.has('title') && entry.topics.size < 3) entry.topics.add(title.slice(0, 60));
        collaboratorCounts.set(person.key, entry);
      }
    }

    if (ts !== undefined && ts > nowMs && ts <= maxTs && allowed.has('title') && !str(value.recurringEventId)) {
      upcoming.push({
        title: title.slice(0, 80),
        date: new Date(ts).toISOString().slice(0, 10),
        attendees: attendees.length,
      });
    }
  }

  const recurringSeries = [...series.values()]
    .filter((entry) => entry.count >= 2)
    .sort((left, right) => right.count - left.count || right.latestTs - left.latestTs)
    .slice(0, 15)
    .map((entry) => {
      const topWeekday = [...entry.weekdays.entries()].sort((a, b) => b[1] - a[1])[0]?.[0];
      const topBucket = [...entry.buckets.entries()].sort((a, b) => b[1] - a[1])[0]?.[0];
      const avgAttendees = entry.attendeeCounts.length
        ? Math.round(entry.attendeeCounts.reduce((sum, n) => sum + n, 0) / entry.attendeeCounts.length)
        : 0;
      return {
        title: entry.title.slice(0, 80),
        occurrences: entry.count,
        role: entry.organizerCount > 0 ? 'organizer' : 'attendee',
        ...(avgAttendees ? { avgAttendees } : {}),
        ...(allowed.has('timestamps') && topWeekday ? { typicalDay: topWeekday, typicalWindow: topBucket } : {}),
      };
    });

  const collaborators = [...collaboratorCounts.values()]
    .filter((entry) => entry.count >= 2)
    .sort((left, right) => right.count - left.count)
    .slice(0, 10)
    .map((entry) => ({
      name: entry.label,
      sharedSmallMeetings: entry.count,
      ...(entry.topics.size ? { sampleTopics: [...entry.topics] } : {}),
    }));

  const payload: JsonRecord = {
    signalSummary: 'googlecalendar',
    windowDays: { past: CALENDAR_PAST_WINDOW_DAYS, future: CALENDAR_FUTURE_WINDOW_DAYS },
    activeEventsAnalyzed: inWindowCount,
    ...(recurringSeries.length ? { patterns: { recurringMeetings: recurringSeries } } : {}),
    ...(allowed.has('timestamps') && weekdayCounts.size ? {
      scheduleRhythm: {
        byWeekday: Object.fromEntries([...weekdayCounts.entries()].sort((a, b) => b[1] - a[1])),
        byTimeOfDay: Object.fromEntries([...bucketCounts.entries()].sort((a, b) => b[1] - a[1])),
      },
    } : {}),
    ...(collaborators.length ? { collaborators } : {}),
    ...(upcoming.length ? {
      highlights: upcoming.sort((a, b) => a.date.localeCompare(b.date)).slice(0, 12),
    } : {}),
  };
  return { payload, recurringSeries: recurringSeries.length, collaborators: collaborators.length };
}

function summarizeGmail(
  items: KnowledgeSourceItem[],
  allowed: Set<string>,
  nowMs: number,
): { payload: JsonRecord; collaborators: number; topicClusters: number } {
  const minTs = nowMs - DEFAULT_WINDOW_DAYS * DAY_MS;
  const owners = extractOwnerIdentities(items);
  let sentCount = 0;
  let humanReceivedCount = 0;
  let automatedCount = 0;
  let cjkChars = 0;
  let latinChars = 0;
  const sentLengths: number[] = [];
  const sentBuckets = new Map<string, number>();
  const sentTo = new Map<string, { label: string; sent: number; received: number }>();
  const signals: UnderstandingSignal[] = [];
  const threadLatest = new Map<string, { ts: number; isSent: boolean; subject: string }>();

  for (const item of items) {
    const ts = itemTimestamp(item);
    if (ts !== undefined && ts < minTs) continue;
    const value = parseNormalized(item);
    const isSent = item.metadata.isSent === true || item.collectionScope === 'sent-messages' || item.metadata.actorAttributed === true;
    const automated = item.metadata.automated === true;
    if (automated && !isSent) {
      automatedCount += 1;
      continue;
    }
    const subject = str(value.subject) ?? itemTitle(item, value);
    if (isSent) {
      sentCount += 1;
      const body = str(value.content) ?? str(value.snippet) ?? '';
      if (body && allowed.has('content')) {
        sentLengths.push(body.length);
        cjkChars += (body.match(/[\p{Script=Han}]/gu) ?? []).length;
        latinChars += (body.match(/[a-zA-Z]/g) ?? []).length;
      }
      if (ts !== undefined && allowed.has('timestamps')) {
        const bucket = timeBucket(ts);
        sentBuckets.set(bucket, (sentBuckets.get(bucket) ?? 0) + 1);
      }
      if (allowed.has('participants')) {
        const rawRecipients = Array.isArray(value.recipients)
          ? value.recipients
          : typeof value.recipients === 'string'
            ? value.recipients.split(',')
            : [];
        for (const entry of rawRecipients) {
          const person = personDisplay(entry);
          if (!person || owners.has(person.key)) continue;
          const acc = sentTo.get(person.key) ?? { label: person.label, sent: 0, received: 0 };
          acc.sent += 1;
          sentTo.set(person.key, acc);
        }
      }
    } else {
      humanReceivedCount += 1;
      if (allowed.has('participants')) {
        const sender = personDisplay(value.sender);
        if (sender && !owners.has(sender.key)) {
          const acc = sentTo.get(sender.key) ?? { label: sender.label, sent: 0, received: 0 };
          acc.received += 1;
          sentTo.set(sender.key, acc);
        }
      }
    }
    const threadKey = str(value.threadId) ?? normalizeTitleKey(subject);
    if (threadKey && ts !== undefined) {
      const prev = threadLatest.get(threadKey);
      if (!prev || ts > prev.ts) threadLatest.set(threadKey, { ts, isSent, subject });
    }
    if (allowed.has('title') && subject) {
      signals.push({
        evidenceRef: `knowledge-source://${item.id}`,
        sourceId: 'connector:gmail',
        title: subject,
        group: str(value.threadId),
        ...(ts !== undefined ? { occurredAt: ts } : {}),
      });
    }
  }

  const clusters = clusterUnderstandingSignals(signals, nowMs).slice(0, 10).map((cluster) => ({
    topic: cluster.title,
    messages: cluster.signals.length,
    horizon: cluster.horizon,
  }));

  const collaborators = [...sentTo.values()]
    .filter((entry) => entry.sent >= 2 || (entry.sent >= 1 && entry.received >= 1))
    .sort((left, right) => (right.sent * 2 + right.received) - (left.sent * 2 + left.received))
    .slice(0, 10)
    .map((entry) => ({
      name: entry.label,
      sent: entry.sent,
      received: entry.received,
    }));

  const openFollowUps = [...threadLatest.values()]
    .filter((thread) => thread.isSent && nowMs - thread.ts <= 21 * DAY_MS)
    .sort((left, right) => right.ts - left.ts)
    .slice(0, 8)
    .map((thread) => ({ subject: thread.subject.slice(0, 80), sentDate: new Date(thread.ts).toISOString().slice(0, 10) }));

  const sortedLengths = [...sentLengths].sort((a, b) => a - b);
  const medianSentChars = sortedLengths.length ? sortedLengths[Math.floor(sortedLengths.length / 2)] : undefined;
  const totalScript = cjkChars + latinChars;
  const primaryLanguage = totalScript >= 50
    ? cjkChars / totalScript >= 0.35
      ? latinChars / totalScript >= 0.2 ? 'zh-en-mixed' : 'zh'
      : 'en'
    : undefined;

  const payload: JsonRecord = {
    signalSummary: 'gmail',
    counts: { sent: sentCount, humanReceived: humanReceivedCount, filteredAutomated: automatedCount },
    ...(clusters.length ? { patterns: { topicClusters: clusters } } : {}),
    ...(collaborators.length ? { collaborators } : {}),
    ...(openFollowUps.length && allowed.has('title') ? { highlights: openFollowUps } : {}),
    ...(primaryLanguage || medianSentChars || sentBuckets.size ? {
      roleBreakdown: {
        ...(primaryLanguage ? { sentLanguageHint: primaryLanguage } : {}),
        ...(medianSentChars ? { medianSentChars } : {}),
        ...(sentBuckets.size ? { activeSendingWindows: Object.fromEntries(sentBuckets) } : {}),
      },
    } : {}),
  };
  return { payload, collaborators: collaborators.length, topicClusters: clusters.length };
}

function summarizeGoogleDrive(
  items: KnowledgeSourceItem[],
  allowed: Set<string>,
  nowMs: number,
): { payload: JsonRecord; topicClusters: number } {
  const mimeCounts = new Map<string, number>();
  const signals: UnderstandingSignal[] = [];
  const recentOwned: Array<{ title: string; updatedAt?: string; enriched: boolean }> = [];
  let ownedCount = 0;
  let enrichedCount = 0;

  for (const item of items) {
    const value = parseNormalized(item);
    const title = itemTitle(item, value);
    const ts = itemTimestamp(item);
    const mime = str(item.metadata.mimeType) ?? str(value.mimeType) ?? 'other';
    const shortType = mime.includes('document') ? 'google_doc'
      : mime.includes('spreadsheet') ? 'google_sheet'
        : mime.includes('presentation') ? 'google_slides'
          : mime.includes('markdown') ? 'markdown'
            : mime.includes('pdf') ? 'pdf' : 'other';
    mimeCounts.set(shortType, (mimeCounts.get(shortType) ?? 0) + 1);
    const isEnriched = item.itemType === 'connected_content';
    if (isEnriched) enrichedCount += 1;
    if (item.metadata.actorAttributed === true) {
      ownedCount += 1;
      if (allowed.has('title')) {
        recentOwned.push({
          title: title.slice(0, 80),
          ...(ts !== undefined && allowed.has('timestamps') ? { updatedAt: new Date(ts).toISOString().slice(0, 10) } : {}),
          enriched: isEnriched,
        });
      }
    }
    if (allowed.has('title') && title) {
      signals.push({
        evidenceRef: `knowledge-source://${item.id}`,
        sourceId: 'connector:googledrive',
        title,
        group: shortType,
        ...(ts !== undefined ? { occurredAt: ts } : {}),
      });
    }
  }

  const clusters = clusterUnderstandingSignals(signals, nowMs).slice(0, 10).map((cluster) => ({
    topic: cluster.title,
    documents: cluster.signals.length,
    horizon: cluster.horizon,
  }));

  const payload: JsonRecord = {
    signalSummary: 'googledrive',
    counts: { totalFiles: items.length, ownedByUser: ownedCount, enrichedDocuments: enrichedCount },
    patterns: {
      documentTypes: Object.fromEntries(mimeCounts),
      ...(clusters.length ? { topicClusters: clusters } : {}),
    },
    ...(recentOwned.length ? { highlights: recentOwned.slice(0, 15) } : {}),
  };
  return { payload, topicClusters: clusters.length };
}

function summarizeGitHub(
  items: KnowledgeSourceItem[],
  allowed: Set<string>,
  nowMs: number,
): { payload: JsonRecord; topicClusters: number } {
  const owners = extractOwnerIdentities(items);
  const languages = new Map<string, number>();
  const topics = new Map<string, number>();
  const activeRepos = new Map<string, number>();
  const labels = new Map<string, number>();
  const signals: UnderstandingSignal[] = [];
  let authoredPrs = 0;
  let authoredIssues = 0;
  let reviewedPrs = 0;
  let ownedRepos = 0;

  for (const item of items) {
    const value = parseNormalized(item);
    const ts = itemTimestamp(item);
    if (item.itemType === 'repository') {
      const repoOwner = str(value.owner)?.toLowerCase();
      const isOwned = Boolean(repoOwner && owners.has(repoOwner) && value.fork !== true);
      if (isOwned) ownedRepos += 1;
      const lang = str(value.language);
      if (lang && (isOwned || value.archived !== true)) {
        languages.set(lang, (languages.get(lang) ?? 0) + (isOwned ? 2 : 1));
      }
      if (Array.isArray(value.topics)) {
        for (const topic of value.topics) {
          if (typeof topic === 'string' && topic.trim()) {
            topics.set(topic.trim(), (topics.get(topic.trim()) ?? 0) + 1);
          }
        }
      }
      continue;
    }
    const repo = str(value.repository);
    if (repo) activeRepos.set(repo, (activeRepos.get(repo) ?? 0) + 1);
    if (item.collectionScope === 'reviewed-work') reviewedPrs += 1;
    else if (value.isPullRequest === true) authoredPrs += 1;
    else authoredIssues += 1;
    if (Array.isArray(value.labels)) {
      for (const label of value.labels) {
        if (typeof label === 'string' && label.trim()) {
          labels.set(label.trim(), (labels.get(label.trim()) ?? 0) + 1);
        }
      }
    }
    const title = itemTitle(item, value);
    if (allowed.has('title') && title) {
      signals.push({
        evidenceRef: `knowledge-source://${item.id}`,
        sourceId: 'connector:github',
        title,
        subjectKey: repo,
        ...(ts !== undefined ? { occurredAt: ts } : {}),
      });
    }
  }

  const clusters = clusterUnderstandingSignals(signals, nowMs).slice(0, 10).map((cluster) => ({
    topic: cluster.title,
    items: cluster.signals.length,
    horizon: cluster.horizon,
  }));

  const payload: JsonRecord = {
    signalSummary: 'github',
    roleBreakdown: { ownedRepos, authoredPrs, authoredIssues, reviewedPrs },
    patterns: {
      topLanguages: Object.fromEntries([...languages.entries()].sort((a, b) => b[1] - a[1]).slice(0, 8)),
      topRepositories: Object.fromEntries([...activeRepos.entries()].sort((a, b) => b[1] - a[1]).slice(0, 10)),
      ...(topics.size ? { topics: [...topics.entries()].sort((a, b) => b[1] - a[1]).slice(0, 10).map(([k]) => k) } : {}),
      ...(labels.size ? { topLabels: [...labels.entries()].sort((a, b) => b[1] - a[1]).slice(0, 10).map(([k]) => k) } : {}),
      ...(clusters.length ? { workThemes: clusters } : {}),
    },
  };
  return { payload, topicClusters: clusters.length };
}

function summarizeLinear(
  items: KnowledgeSourceItem[],
  allowed: Set<string>,
  nowMs: number,
): { payload: JsonRecord; topicClusters: number } {
  const projects = new Map<string, number>();
  const states = new Map<string, number>();
  const labels = new Map<string, number>();
  const cycles = new Map<string, number>();
  const signals: UnderstandingSignal[] = [];
  const upcomingDue: Array<{ title: string; dueDate: string }> = [];

  for (const item of items) {
    const value = parseNormalized(item);
    const ts = itemTimestamp(item);
    const project = str(asRecord(value.project).name) ?? str(value.project);
    if (project) projects.set(project, (projects.get(project) ?? 0) + 1);
    const state = str(asRecord(value.state).name) ?? str(value.state);
    if (state) states.set(state, (states.get(state) ?? 0) + 1);
    const cycle = str(value.cycle);
    if (cycle) cycles.set(cycle, (cycles.get(cycle) ?? 0) + 1);
    if (Array.isArray(value.labels)) {
      for (const label of value.labels) {
        if (typeof label === 'string' && label.trim()) {
          labels.set(label.trim(), (labels.get(label.trim()) ?? 0) + 1);
        }
      }
    }
    const title = itemTitle(item, value);
    const dueTs = timestampMs(str(value.dueDate));
    if (dueTs !== undefined && dueTs >= nowMs && dueTs <= nowMs + 45 * DAY_MS && allowed.has('title')) {
      upcomingDue.push({ title: title.slice(0, 80), dueDate: new Date(dueTs).toISOString().slice(0, 10) });
    }
    if (allowed.has('title') && title) {
      signals.push({
        evidenceRef: `knowledge-source://${item.id}`,
        sourceId: 'connector:linear',
        title,
        subjectKey: project,
        ...(ts !== undefined ? { occurredAt: ts } : {}),
      });
    }
  }

  const clusters = clusterUnderstandingSignals(signals, nowMs).slice(0, 10).map((cluster) => ({
    topic: cluster.title,
    issues: cluster.signals.length,
    horizon: cluster.horizon,
  }));

  const payload: JsonRecord = {
    signalSummary: 'linear',
    counts: { totalIssues: items.length },
    patterns: {
      projects: Object.fromEntries([...projects.entries()].sort((a, b) => b[1] - a[1]).slice(0, 10)),
      states: Object.fromEntries(states),
      ...(cycles.size ? { activeCycles: [...cycles.keys()].slice(0, 5) } : {}),
      ...(labels.size ? { topLabels: [...labels.entries()].sort((a, b) => b[1] - a[1]).slice(0, 10).map(([k]) => k) } : {}),
      ...(clusters.length ? { workThemes: clusters } : {}),
    },
    ...(upcomingDue.length ? { highlights: upcomingDue.sort((a, b) => a.dueDate.localeCompare(b.dueDate)).slice(0, 10) } : {}),
  };
  return { payload, topicClusters: clusters.length };
}

/** Deterministic per-connector signal aggregation over retained items (zero LLM cost). */
export function buildConnectorSignalSummary(input: {
  toolkit: string;
  items: KnowledgeSourceItem[];
  consent?: UnderstandingConsentReceipt;
  nowMs?: number;
}): ConnectorSignalSummaryResult {
  const toolkit = input.toolkit.trim().toLowerCase();
  const sourceId = toolkit ? `connector:${toolkit}` : 'connected-work';
  const activeItems = input.items.filter((item) => !item.deletedAt && item.sensitivity !== 'secret' && item.sensitivity !== 'regulated');
  if (!activeItems.length || !input.consent) {
    return {
      toolkit,
      sourceId,
      backingEvidenceRefs: [],
      ownerBackedEvidenceRefs: [],
      metrics: { totalItems: 0, ownerItems: 0, distinctOwnerDates: 0 },
    };
  }
  const nowMs = input.nowMs ?? Date.now();
  const allowed = new Set(input.consent.allowedFields);
  const { backingEvidenceRefs, ownerBackedEvidenceRefs, distinctOwnerDates } = selectRepresentativeRefs(activeItems);

  let payload: JsonRecord;
  let recurringSeries: number | undefined;
  let collaborators: number | undefined;
  let topicClusters: number | undefined;

  if (toolkit === 'googlecalendar') {
    const res = summarizeCalendar(activeItems, allowed, nowMs);
    payload = res.payload;
    recurringSeries = res.recurringSeries;
    collaborators = res.collaborators;
  } else if (toolkit === 'gmail') {
    const res = summarizeGmail(activeItems, allowed, nowMs);
    payload = res.payload;
    collaborators = res.collaborators;
    topicClusters = res.topicClusters;
  } else if (toolkit === 'googledrive') {
    const res = summarizeGoogleDrive(activeItems, allowed, nowMs);
    payload = res.payload;
    topicClusters = res.topicClusters;
  } else if (toolkit === 'github') {
    const res = summarizeGitHub(activeItems, allowed, nowMs);
    payload = res.payload;
    topicClusters = res.topicClusters;
  } else if (toolkit === 'linear') {
    const res = summarizeLinear(activeItems, allowed, nowMs);
    payload = res.payload;
    topicClusters = res.topicClusters;
  } else if (toolkit === 'local-files' || toolkit === 'local-folder') {
    const res = summarizeGoogleDrive(activeItems, allowed, nowMs);
    payload = { ...res.payload, signalSummary: 'local-files' };
    topicClusters = res.topicClusters;
  } else {
    payload = { signalSummary: toolkit || 'connected', totalItems: activeItems.length };
  }

  const latestTs = activeItems
    .map(itemTimestamp)
    .filter((ts): ts is number => ts !== undefined)
    .reduce((max, ts) => Math.max(max, ts), 0);

  const summaryItem: UnderstandingSourceItem = {
    id: `signal-summary:${toolkit || 'connected'}`,
    sourceId,
    type: 'note',
    title: `${toolkit || 'Connected source'} aggregated signal summary`,
    text: JSON.stringify(payload).slice(0, 12_000),
    group: `${toolkit || 'connected'}:signal-summary`,
    ...(latestTs > 0 && allowed.has('timestamps') ? { occurredAt: latestTs, modifiedAt: latestTs } : {}),
    ownerAttribution: ownerBackedEvidenceRefs.length > 0 ? 'user' : 'shared',
    sensitivity: 'personal',
    evidenceRef: `signal-summary://${toolkit || 'connected'}`,
  };

  return {
    toolkit,
    sourceId,
    summaryItem,
    backingEvidenceRefs,
    ownerBackedEvidenceRefs,
    metrics: {
      totalItems: activeItems.length,
      ownerItems: activeItems.filter((item) => item.metadata.actorAttributed === true).length,
      distinctOwnerDates,
      ...(recurringSeries !== undefined ? { recurringSeries } : {}),
      ...(collaborators !== undefined ? { collaborators } : {}),
      ...(topicClusters !== undefined ? { topicClusters } : {}),
    },
  };
}
