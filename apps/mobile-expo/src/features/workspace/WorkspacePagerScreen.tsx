import { StyleSheet, View } from 'react-native';

import { WorkspaceHomeScreen } from './WorkspaceHomeScreen';
import { WorkspaceNavigationProvider } from './workspace-navigation-context';

export function WorkspacePagerScreen() {
  return (
    <WorkspaceNavigationProvider>
      <View style={styles.screen}>
        <WorkspaceHomeScreen />
      </View>
    </WorkspaceNavigationProvider>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1 },
});
