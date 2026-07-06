import { useQueryClient } from '@tanstack/react-query';
import { useCallback } from 'react';
import { BackHandler, StyleSheet, View } from 'react-native';
import Animated, { useAnimatedStyle } from 'react-native-reanimated';
import { useFocusEffect } from 'expo-router';

import { motion } from '../../motion';
import { invalidateHomeFeed } from '../../query/workspace-sync';
import { useTheme } from '../../theme';

import { AskAiHeroGhost } from './AskAiHeroGhost';
import { WorkspaceChatOverlay } from './WorkspaceChatOverlay';
import { WorkspaceHomeScreen } from './WorkspaceHomeScreen';
import { WorkspaceNavigationProvider } from './workspace-navigation-context';
import {
  useWorkspaceTransition,
  WorkspaceTransitionProvider,
} from './workspace-transition-context';

const AnimatedView = Animated.createAnimatedComponent(View);

function WorkspaceShellContent() {
  const { colors } = useTheme();
  const { phase, progress, dismissDrag, closeAskAi } = useWorkspaceTransition();

  const handleRequestHome = useCallback(() => {
    closeAskAi();
  }, [closeAskAi]);

  const homeLayerStyle = useAnimatedStyle(() => {
    const openAmount = progress.value * (1 - dismissDrag.value / motion.dismiss.maxDragFraction);
    const scale = 1 - (1 - motion.home.scaleOpen) * openAmount;
    const opacity = 1 - (1 - motion.home.opacityOpen) * openAmount;
    return {
      opacity,
      transform: [{ scale }],
    };
  });

  useFocusEffect(
    useCallback(() => {
      const subscription = BackHandler.addEventListener('hardwareBackPress', () => {
        if (phase === 'closed' || phase === 'closing') return false;
        closeAskAi();
        return true;
      });

      return () => subscription.remove();
    }, [closeAskAi, phase]),
  );

  return (
    <View style={[styles.screen, { backgroundColor: colors.surface.base }]}>
      <AnimatedView style={[styles.homeLayer, homeLayerStyle]}>
        <WorkspaceHomeScreen />
      </AnimatedView>
      <WorkspaceChatOverlay onRequestHome={handleRequestHome} />
      <AskAiHeroGhost />
    </View>
  );
}

export function WorkspacePagerScreen() {
  const queryClient = useQueryClient();

  const refreshHomeFeed = useCallback(() => {
    invalidateHomeFeed(queryClient);
  }, [queryClient]);

  return (
    <WorkspaceTransitionProvider onClosed={refreshHomeFeed}>
      <WorkspaceNavigationProvider>
        <WorkspaceShellContent />
      </WorkspaceNavigationProvider>
    </WorkspaceTransitionProvider>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1 },
  homeLayer: { flex: 1 },
});
