/**
 * Agent detail — a mobile-first read-only profile for a gateway agent.
 */
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { ScrollView, StyleSheet, View } from 'react-native';
import { ActivityIndicator, Button, Icon, Text } from 'react-native-paper';

import { FloatingHeader } from '../../components/FloatingHeader';
import { useMessages, t } from '../../i18n/messages';
import { openChat, useDismissOnHardwareBack } from '../../lib/navigation';
import { fetchChatAgents, type ChatAgentOption } from '../../query/agents';
import { queryKeys } from '../../query/keys';
import { createSession, useGatewayConfigured } from '../../query/sessions';
import { invalidateSessionLists } from '../../query/workspace-sync';
import { usePreferencesStore } from '../../stores/preferences-store';
import { useSettingsColors } from '../settings/settings-ui';
import { pickEffectiveDefaultId, useSetDefaultAgent } from '../settings/use-set-default-agent';
import { AgentAvatar } from './AgentAvatar';

function firstParam(value: string | string[] | undefined): string {
  return Array.isArray(value) ? value[0] ?? '' : value ?? '';
}

function displayName(agent: ChatAgentOption): string {
  return agent.name?.trim() || agent.id;
}

function formatCount(template: string, count: number): string {
  return t(template, { count });
}

function joinList(items: string[] | undefined, fallback: string): string {
  const clean = (items ?? []).map((item) => item.trim()).filter(Boolean);
  return clean.length ? clean.join(', ') : fallback;
}

export function AgentDetailScreen() {
  const router = useRouter();
  useDismissOnHardwareBack(router);
  const { id } = useLocalSearchParams<{ id?: string | string[] }>();
  const agentId = firstParam(id).trim().toLowerCase();
  const queryClient = useQueryClient();
  const colors = useSettingsColors();
  const configured = useGatewayConfigured();
  const m = useMessages();
  const am = m.agentsPage;
  const localOverride = usePreferencesStore((s) => s.defaultAgentId);

  const agentsQuery = useQuery({
    queryKey: queryKeys.agents,
    queryFn: fetchChatAgents,
    enabled: configured,
  });

  const setDefaultMut = useSetDefaultAgent();
  const createMut = useMutation({
    mutationFn: (selectedAgentId: string) => createSession(selectedAgentId),
    onSuccess: (key) => {
      invalidateSessionLists(queryClient);
      openChat(router, key, { replace: true });
    },
  });

  const agents = agentsQuery.data?.items ?? [];
  const agent = agents.find((item) => item.id === agentId);
  const effectiveId = pickEffectiveDefaultId(agentsQuery.data, localOverride);
  const selected = agent?.id === effectiveId;

  if (agentsQuery.isLoading) {
    return (
      <View style={{ flex: 1, backgroundColor: colors.pageBg }}>
        <FloatingHeader title={am.detailTitle} onBack={() => router.back()} />
        <View style={styles.center}>
          <ActivityIndicator size="large" />
        </View>
      </View>
    );
  }

  if (!configured || agentsQuery.isError || !agent) {
    return (
      <View style={{ flex: 1, backgroundColor: colors.pageBg }}>
        <FloatingHeader title={am.detailTitle} onBack={() => router.back()} />
        <View style={styles.center}>
          <Icon source="robot-off-outline" size={48} color={colors.textMuted} />
          <Text style={[styles.emptyText, { color: colors.textMuted }]}>
            {!configured ? m.sessions.gatewayNotConfigured : am.agentNotFound}
          </Text>
          <Button mode="outlined" onPress={() => void queryClient.invalidateQueries({ queryKey: queryKeys.agents })}>
            {m.common.retry}
          </Button>
        </View>
      </View>
    );
  }

  const model = agent.model?.primary?.trim() || am.inheritedValue;
  const fallbacks = joinList(agent.model?.fallbacks, am.noneValue);
  const typedDefaults = agent.typedModels?.defaults?.length ?? 0;
  const typedEffective = agent.typedModels?.effective?.length ?? 0;
  const disabledTools = agent.tools?.effectiveDisable?.length ?? 0;
  const skillCount = agent.skills?.effectiveAllowlist?.length ?? 0;

  return (
    <View style={{ flex: 1, backgroundColor: colors.pageBg }}>
      <FloatingHeader title={am.detailTitle} onBack={() => router.back()} />
      <ScrollView
        style={{ flex: 1 }}
        contentContainerStyle={styles.scroll}
        showsVerticalScrollIndicator={false}
      >
        <View style={[styles.hero, { backgroundColor: colors.card }]}>
          <AgentAvatar agentId={agent.id} avatar={agent.avatar} size={56} />
          <View style={styles.heroText}>
            <View style={styles.titleRow}>
              <Text style={[styles.name, { color: colors.text }]} numberOfLines={1}>
                {displayName(agent)}
              </Text>
              <View
                style={[
                  styles.badge,
                  { backgroundColor: selected ? colors.accentSoft : colors.pageBg },
                ]}
              >
                <Text style={[styles.badgeText, { color: selected ? colors.accent : colors.textMuted }]}>
                  {selected ? am.defaultBadge : am.customBadge}
                </Text>
              </View>
            </View>
            <Text style={[styles.agentId, { color: colors.textMuted }]} numberOfLines={1}>
              {agent.id}
            </Text>
            <Text
              style={[styles.description, { color: agent.description ? colors.text : colors.textMuted }]}
              numberOfLines={4}
            >
              {agent.description || am.noDescription}
            </Text>
          </View>
        </View>

        <View style={styles.actions}>
          <Button
            mode="contained"
            icon="chat-plus-outline"
            loading={createMut.isPending}
            disabled={createMut.isPending}
            onPress={() => createMut.mutate(agent.id)}
            style={styles.actionButton}
          >
            {am.chatWith}
          </Button>
          <Button
            mode="outlined"
            icon={selected ? 'check-circle-outline' : 'star-outline'}
            loading={setDefaultMut.isPending}
            disabled={selected || setDefaultMut.isPending}
            onPress={() => setDefaultMut.mutate(agent.id)}
            style={styles.actionButton}
          >
            {selected ? am.isDefaultAction : am.setDefaultAction}
          </Button>
        </View>

        <DetailSection title={am.overviewSection}>
          <DetailRow label={am.workspaceLabel} value={agent.workspace || am.unsetValue} mono />
          <DetailRow label={am.profileDirLabel} value={agent.profileDir || am.unsetValue} mono />
          <DetailRow label={am.languageLabel} value={agent.language || am.inheritedValue} />
        </DetailSection>

        <DetailSection title={am.runtimeSection}>
          <DetailRow label={am.modelLabel} value={model} mono />
          <DetailRow label={am.fallbacksLabel} value={fallbacks} mono />
          <DetailRow
            label={am.typedModelsLabel}
            value={t(am.typedModelsSummary, { defaults: typedDefaults, effective: typedEffective })}
          />
        </DetailSection>

        <DetailSection title={am.capabilitiesSection}>
          <DetailRow
            label={am.toolsLabel}
            value={disabledTools > 0 ? formatCount(am.toolsDisabledCount, disabledTools) : am.toolsAllEnabled}
          />
          <DetailRow
            label={am.skillsLabel}
            value={skillCount > 0 ? formatCount(am.skillsCount, skillCount) : am.skillsInherited}
          />
          <DetailRow
            label={am.entryToolsLabel}
            value={joinList(agent.tools?.entryDisable, am.inheritedValue)}
            mono
          />
          <DetailRow
            label={am.entrySkillsLabel}
            value={joinList(agent.skills?.entry, am.inheritedValue)}
            mono
          />
        </DetailSection>

        <Button
          mode="text"
          icon="refresh"
          onPress={() => void queryClient.invalidateQueries({ queryKey: queryKeys.agents })}
          style={styles.refresh}
        >
          {am.refresh}
        </Button>
      </ScrollView>
    </View>
  );
}

function DetailSection({ title, children }: { title: string; children: React.ReactNode }) {
  const colors = useSettingsColors();
  return (
    <View style={styles.section}>
      <Text style={[styles.sectionTitle, { color: colors.textMuted }]}>{title}</Text>
      <View style={[styles.sectionBody, { backgroundColor: colors.card }]}>{children}</View>
    </View>
  );
}

function DetailRow({ label, value, mono }: { label: string; value: string; mono?: boolean }) {
  const colors = useSettingsColors();
  return (
    <View style={styles.row}>
      <Text style={[styles.rowLabel, { color: colors.textMuted }]}>{label}</Text>
      <Text
        style={[styles.rowValue, { color: colors.text }, mono && styles.mono]}
        numberOfLines={2}
      >
        {value}
      </Text>
    </View>
  );
}

const styles = StyleSheet.create({
  center: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    padding: 32,
    gap: 12,
  },
  scroll: {
    paddingHorizontal: 16,
    paddingTop: 12,
    paddingBottom: 32,
  },
  emptyText: {
    marginTop: 12,
    fontSize: 14,
    textAlign: 'center',
  },
  hero: {
    borderRadius: 12,
    padding: 14,
    flexDirection: 'row',
    gap: 12,
  },
  heroText: {
    flex: 1,
    minWidth: 0,
  },
  titleRow: {
    minHeight: 28,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  name: {
    flex: 1,
    minWidth: 0,
    fontSize: 20,
    fontWeight: '700',
  },
  badge: {
    minHeight: 24,
    borderRadius: 12,
    paddingHorizontal: 8,
    alignItems: 'center',
    justifyContent: 'center',
  },
  badgeText: {
    fontSize: 12,
    fontWeight: '600',
  },
  agentId: {
    marginTop: 2,
    fontSize: 12,
    fontFamily: 'monospace',
  },
  description: {
    marginTop: 10,
    fontSize: 14,
    lineHeight: 20,
  },
  actions: {
    flexDirection: 'row',
    gap: 10,
    marginTop: 12,
  },
  actionButton: {
    flex: 1,
    borderRadius: 10,
  },
  section: {
    marginTop: 18,
  },
  sectionTitle: {
    fontSize: 13,
    fontWeight: '600',
    marginBottom: 8,
    marginLeft: 4,
  },
  sectionBody: {
    borderRadius: 12,
    overflow: 'hidden',
  },
  row: {
    paddingHorizontal: 14,
    paddingVertical: 12,
    gap: 4,
  },
  rowLabel: {
    fontSize: 12,
    fontWeight: '600',
  },
  rowValue: {
    fontSize: 15,
    lineHeight: 20,
  },
  mono: {
    fontFamily: 'monospace',
    fontSize: 13,
  },
  refresh: {
    marginTop: 12,
    alignSelf: 'center',
  },
});
