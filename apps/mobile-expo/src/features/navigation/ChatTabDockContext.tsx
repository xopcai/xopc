import { createContext, useContext, type ComponentProps } from 'react';
import type { Tabs } from 'expo-router';
import type { BottomTabBarProps } from 'expo-router/js-tabs';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { CapsuleTabBar } from './CapsuleTabBar';

const ChatTabDockContext = createContext<BottomTabBarProps | null>(null);
type TabLayoutProps = Parameters<NonNullable<ComponentProps<typeof Tabs>['layout']>>[0];

/** Keep navigation state with the navigator while rendering Chat's dock inside its composer surface. */
export function ChatTabDockProvider({ children, ...props }: TabLayoutProps) {
  const insets = useSafeAreaInsets();
  // Expo's generic layout type omits TabActionHelpers; these descriptors come from TabRouter.
  const descriptors = props.descriptors as BottomTabBarProps['descriptors'];
  return <ChatTabDockContext.Provider value={{ ...props, descriptors, insets }}>{children}</ChatTabDockContext.Provider>;
}

export function ChatTabDock() {
  const props = useContext(ChatTabDockContext);
  if (!props || props.state.routes[props.state.index].name !== '(chat)') return null;
  return <CapsuleTabBar {...props} embedded />;
}
