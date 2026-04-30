/**
 * Drawer layout — wraps the chat screen with a custom sidebar.
 *
 * expo-router file-system route: app/(drawer)/_layout.tsx
 * The only screen inside this group is `index` (the chat page).
 */
import { Drawer } from 'expo-router/drawer';

import { DrawerContent } from '../../src/components/DrawerContent';

export default function DrawerLayout() {
  return (
    <Drawer
      drawerContent={(props) => <DrawerContent {...props} />}
      screenOptions={{
        headerShown: false,
        drawerType: 'front',
        drawerStyle: { width: '80%' },
        swipeEnabled: true,
        swipeEdgeWidth: 40,
      }}
    >
      <Drawer.Screen name="index" options={{ headerShown: false }} />
    </Drawer>
  );
}
