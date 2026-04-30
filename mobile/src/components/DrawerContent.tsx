/**
 * Custom drawer sidebar content.
 *
 * Layout (from top to bottom):
 * 1. "+ New chat" button
 * 2. Navigation menu items (Agents, Skills, Cron, Channels)
 * 3. "Conversations" section label + tab strip (Chats / Channels) — placeholder
 * 4. Scrollable session list (active session highlighted)
 * 5. Bottom bar: XOPC brand + settings gear
 */
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { DrawerContentComponentProps } from '@react-navigation/drawer';
import { useRouter } from 'expo-router';
import { useCallback, useRef, useState } from 'react';
import {
  FlatList,
  Linking,
  Pressable,
  StyleSheet,
  useColorScheme,
  View,
} from 'react-native';
import {
  Divider,
  Icon,
  IconButton,
  Menu,
  Text,
  TouchableRipple,
} from 'react-native-paper';

import { useMessages } from '../i18n/messages';
import { queryKeys } from '../query/keys';
import {
  createSession,
  fetchSessionsList,
  useGatewayConfigured,
} from '../query/sessions';
import type { SessionListItem } from '../query/sessions';
import { usePreferencesStore } from '../stores/preferences-store';
import type { Language, ThemePreference } from '../stores/preferences-store';

/** Navigation menu items — functional placeholders (non-navigable for now). */
const NAV_ITEMS = [
  { id: 'agents', icon: 'account-group-outline', labelKey: 'agents' as const },
  { id: 'skills', icon: 'layers-outline', labelKey: 'skills' as const },
  { id: 'cron', icon: 'clock-outline', labelKey: 'cron' as const },
  { id: 'channels', icon: 'swap-horizontal', labelKey: 'channels' as const },
] as const;

/** Tab options for the conversation section. */
const TABS = ['chats', 'channels'] as const;
type Tab = (typeof TABS)[number];

export function DrawerContent(_props: DrawerContentComponentProps) {
  const router = useRouter();
  const queryClient = useQueryClient();
  const isDark = useColorScheme() === 'dark';
  const configured = useGatewayConfigured();
  const m = useMessages();
  const dm = m.drawer;
  const sm = m.drawerMenu;

  const [activeTab, setActiveTab] = useState<Tab>('chats');

  // ── Settings popup menu state ────────────────────────────
  const [menuVisible, setMenuVisible] = useState(false);
  const [langSubVisible, setLangSubVisible] = useState(false);
  const [themeSubVisible, setThemeSubVisible] = useState(false);
  const gearRef = useRef<View>(null);

  const language = usePreferencesStore((s) => s.language);
  const themePreference = usePreferencesStore((s) => s.themePreference);
  const setLanguage = usePreferencesStore((s) => s.setLanguage);
  const setThemePreference = usePreferencesStore((s) => s.setThemePreference);

  // ── Data ─────────────────────────────────────────────────
  const sessionsQuery = useQuery({
    queryKey: queryKeys.sessions,
    queryFn: fetchSessionsList,
    enabled: configured,
  });

  const sessions = sessionsQuery.data ?? [];

  // ── New session ──────────────────────────────────────────
  const createMut = useMutation({
    mutationFn: (_agentId?: string) => createSession(_agentId),
    onSuccess: (key) => {
      void queryClient.invalidateQueries({ queryKey: queryKeys.sessions });
      router.setParams({ k: key });
      // Close the drawer by navigating
      router.navigate({ pathname: '/', params: { k: key } });
    },
  });

  const handleNewChat = useCallback(() => {
    createMut.mutate(undefined);
  }, [createMut]);

  // ── Session tap ──────────────────────────────────────────
  const handleSessionTap = useCallback(
    (session: SessionListItem) => {
      router.navigate({ pathname: '/', params: { k: session.key } });
    },
    [router],
  );

  // ── Colors ───────────────────────────────────────────────
  const colors = {
    bg: isDark ? '#0F1A12' : '#E8F5E9',
    surface: isDark ? '#1A2E1E' : '#F1F8E9',
    activeBg: isDark ? '#2E5233' : '#C8E6C9',
    text: isDark ? '#C8E6C9' : '#1B5E20',
    textMuted: isDark ? '#81C784' : '#388E3C',
    textSubtle: isDark ? '#4CAF50' : '#66BB6A',
    border: isDark ? '#2E7D32' : '#A5D6A7',
    brandBg: isDark ? '#1A2E1E' : '#E0F2E0',
  };

  // ── Render session item ──────────────────────────────────
  const renderSession = useCallback(
    ({ item }: { item: SessionListItem }) => {
      const label = item.name?.trim() || item.key.slice(-24);
      return (
        <TouchableRipple
          key={item.key}
          style={[styles.sessionItem]}
          onPress={() => handleSessionTap(item)}
          rippleColor={colors.activeBg}
        >
          <Text
            numberOfLines={1}
            style={[styles.sessionLabel, { color: colors.text }]}
          >
            {label}
          </Text>
        </TouchableRipple>
      );
    },
    [handleSessionTap, colors],
  );

  return (
    <View style={[styles.container, { backgroundColor: colors.bg }]}>
      {/* ── New chat button ──────────────────────────── */}
      <Pressable
        style={[styles.newChatButton, { backgroundColor: colors.surface }]}
        onPress={handleNewChat}
      >
        <Icon source="plus" size={18} color={colors.text} />
        <Text style={[styles.newChatLabel, { color: colors.text }]}>
          {dm.newChat}
        </Text>
      </Pressable>

      {/* ── Nav menu ─────────────────────────────────── */}
      <View style={styles.navSection}>
        {NAV_ITEMS.map((item) => (
          <TouchableRipple
            key={item.id}
            style={styles.navItem}
            onPress={() => {
              if (item.id === 'agents') {
                router.push('/agents');
              } else if (item.id === 'skills') {
                router.push('/skills');
              } else if (item.id === 'channels') {
                router.push('/channels');
              }
            }}
            rippleColor={colors.activeBg}
          >
            <View style={styles.navItemRow}>
              <Icon source={item.icon} size={20} color={colors.textMuted} />
              <Text style={[styles.navLabel, { color: colors.text }]}>
                {dm[item.labelKey]}
              </Text>
            </View>
          </TouchableRipple>
        ))}

      </View>

      <Divider style={{ backgroundColor: colors.border }} />

      {/* ── Conversations section ────────────────────── */}
      <Text style={[styles.sectionTitle, { color: colors.textMuted }]}>
        {dm.conversations}
      </Text>

      {/* Tab strip */}
      <View style={[styles.tabStrip, { backgroundColor: colors.surface, borderColor: colors.border }]}>
        {TABS.map((tab) => {
          const active = tab === activeTab;
          return (
            <Pressable
              key={tab}
              style={[
                styles.tab,
                active && { backgroundColor: colors.bg },
              ]}
              onPress={() => setActiveTab(tab)}
            >
              <Icon
                source={tab === 'chats' ? 'chat-outline' : 'message-outline'}
                size={14}
                color={active ? colors.text : colors.textSubtle}
              />
              <Text
                style={[
                  styles.tabLabel,
                  { color: active ? colors.text : colors.textSubtle },
                  active && styles.tabLabelActive,
                ]}
              >
                {tab === 'chats' ? dm.chats : dm.channelsTab}
              </Text>
            </Pressable>
          );
        })}
      </View>

      {/* ── Session list ─────────────────────────────── */}
      <FlatList
        data={sessions}
        keyExtractor={(item) => item.key}
        renderItem={renderSession}
        contentContainerStyle={styles.sessionList}
        showsVerticalScrollIndicator={false}
        style={styles.sessionListFlex}
      />

      <Divider style={{ backgroundColor: colors.border }} />

      {/* ── Bottom bar ───────────────────────────────── */}
      <View style={[styles.bottomBar, { backgroundColor: colors.brandBg }]}>
        <View style={styles.bottomBrand}>
          <View style={[styles.logoCircle, { borderColor: colors.textMuted }]}>
            <Text style={[styles.logoText, { color: colors.textMuted }]}>X</Text>
          </View>
          <View style={styles.bottomBrandText}>
            <Text style={[styles.brandName, { color: colors.text }]}>XOPC</Text>
            <Text style={[styles.brandDesc, { color: colors.textSubtle }]}>
              {dm.brandDescription}
            </Text>
          </View>
        </View>

        {/* Settings gear — opens popup menu */}
        <Menu
          visible={menuVisible}
          onDismiss={() => {
            setMenuVisible(false);
            setLangSubVisible(false);
            setThemeSubVisible(false);
          }}
          anchor={
            <View ref={gearRef}>
              <IconButton
                icon="cog-outline"
                size={20}
                iconColor={colors.textMuted}
                onPress={() => setMenuVisible(true)}
              />
            </View>
          }
          anchorPosition="top"
          contentStyle={[
            styles.menuContent,
            { backgroundColor: colors.bg, borderColor: colors.border },
          ]}
        >
          {/* ── Language sub-menu ───────────── */}
          <Menu.Item
            leadingIcon="web"
            title={sm.language}
            trailingIcon={langSubVisible ? 'chevron-up' : 'chevron-right'}
            onPress={() => {
              setLangSubVisible(!langSubVisible);
              setThemeSubVisible(false);
            }}
            titleStyle={{ color: colors.text }}
          />
          {langSubVisible ? (
            <View style={styles.subMenu}>
              {(['en', 'zh'] as Language[]).map((lang) => (
                <Menu.Item
                  key={lang}
                  title={lang === 'en' ? 'English' : '中文'}
                  onPress={() => {
                    setLanguage(lang);
                    setLangSubVisible(false);
                    setMenuVisible(false);
                  }}
                  titleStyle={{
                    color: language === lang ? colors.textMuted : colors.text,
                    fontWeight: language === lang ? '700' : '400',
                  }}
                  style={styles.subMenuItem}
                />
              ))}
            </View>
          ) : null}

          {/* ── Theme sub-menu ─────────────── */}
          <Menu.Item
            leadingIcon="theme-light-dark"
            title={sm.theme}
            trailingIcon={themeSubVisible ? 'chevron-up' : 'chevron-right'}
            onPress={() => {
              setThemeSubVisible(!themeSubVisible);
              setLangSubVisible(false);
            }}
            titleStyle={{ color: colors.text }}
          />
          {themeSubVisible ? (
            <View style={styles.subMenu}>
              {(['light', 'dark', 'system'] as ThemePreference[]).map((pref) => {
                const labelMap = { light: sm.themeLight, dark: sm.themeDark, system: sm.themeSystem };
                return (
                  <Menu.Item
                    key={pref}
                    title={labelMap[pref]}
                    onPress={() => {
                      setThemePreference(pref);
                      setThemeSubVisible(false);
                      setMenuVisible(false);
                    }}
                    titleStyle={{
                      color: themePreference === pref ? colors.textMuted : colors.text,
                      fontWeight: themePreference === pref ? '700' : '400',
                    }}
                    style={styles.subMenuItem}
                  />
                );
              })}
            </View>
          ) : null}

          {/* ── Font size (placeholder) ────── */}
          <Menu.Item
            leadingIcon="format-size"
            title={sm.fontSize}
            trailingIcon="chevron-right"
            onPress={() => {}}
            titleStyle={{ color: colors.text }}
          />

          <Divider style={{ backgroundColor: colors.border, marginVertical: 4 }} />

          {/* ── About ──────────────────────── */}
          <Menu.Item
            leadingIcon="information-outline"
            title={sm.about}
            onPress={() => {
              setMenuVisible(false);
            }}
            titleStyle={{ color: colors.text }}
          />

          {/* ── Help docs ──────────────────── */}
          <Menu.Item
            leadingIcon="book-open-variant"
            title={sm.helpDocs}
            trailingIcon="open-in-new"
            onPress={() => {
              setMenuVisible(false);
              void Linking.openURL('https://github.com/nicepkg/xopc');
            }}
            titleStyle={{ color: colors.text }}
          />

          {/* ── Open all settings ──────────── */}
          <Menu.Item
            leadingIcon="cog-outline"
            title={sm.openAllSettings}
            onPress={() => {
              setMenuVisible(false);
              router.push('/settings');
            }}
            titleStyle={{ color: colors.text }}
          />
        </Menu>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    paddingTop: 56,
  },
  // ── New chat ──
  newChatButton: {
    flexDirection: 'row',
    alignItems: 'center',
    marginHorizontal: 12,
    marginBottom: 8,
    paddingVertical: 12,
    paddingHorizontal: 16,
    borderRadius: 12,
    gap: 10,
  },
  newChatLabel: {
    fontSize: 15,
    fontWeight: '600',
  },
  // ── Nav ──
  navSection: {
    paddingVertical: 4,
  },
  navItem: {
    paddingVertical: 10,
    paddingHorizontal: 16,
  },
  navItemRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
  },
  navLabel: {
    fontSize: 14,
    fontWeight: '500',
  },
  // ── Section title ──
  sectionTitle: {
    fontSize: 12,
    fontWeight: '600',
    marginTop: 12,
    marginBottom: 6,
    marginHorizontal: 16,
    textTransform: 'uppercase',
    letterSpacing: 0.5,
  },
  // ── Tab strip ──
  tabStrip: {
    flexDirection: 'row',
    marginHorizontal: 12,
    marginBottom: 8,
    borderRadius: 10,
    borderWidth: 1,
    padding: 2,
  },
  tab: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: 6,
    borderRadius: 8,
    gap: 5,
  },
  tabLabel: {
    fontSize: 13,
    fontWeight: '500',
  },
  tabLabelActive: {
    fontWeight: '600',
  },
  // ── Session list ──
  sessionListFlex: {
    flex: 1,
  },
  sessionList: {
    paddingHorizontal: 12,
    paddingBottom: 8,
  },
  sessionItem: {
    paddingVertical: 10,
    paddingHorizontal: 12,
    borderRadius: 10,
    marginBottom: 2,
  },
  sessionLabel: {
    fontSize: 14,
  },
  // ── Bottom bar ──
  bottomBar: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 12,
    paddingVertical: 8,
  },
  bottomBrand: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
  },
  logoCircle: {
    width: 32,
    height: 32,
    borderRadius: 16,
    borderWidth: 1.5,
    alignItems: 'center',
    justifyContent: 'center',
  },
  logoText: {
    fontSize: 14,
    fontWeight: '700',
  },
  bottomBrandText: {
    gap: 1,
  },
  brandName: {
    fontSize: 14,
    fontWeight: '700',
  },
  brandDesc: {
    fontSize: 11,
  },
  // ── Settings popup menu ──
  menuContent: {
    borderRadius: 14,
    borderWidth: 1,
    paddingVertical: 4,
    minWidth: 220,
  },
  subMenu: {
    paddingLeft: 12,
  },
  subMenuItem: {
    height: 40,
  },
});
