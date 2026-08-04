import { HStack, Link, Spacer, Text, VStack } from '@expo/ui/swift-ui';
import { font, foregroundStyle, padding } from '@expo/ui/swift-ui/modifiers';
import { createWidget, type WidgetEnvironment } from 'expo-widgets';

function QuickEntryWidget(_props: object, environment: WidgetEnvironment) {
  'widget';
  const secondary = environment.colorScheme === 'dark' ? '#AEB7C6' : '#526070';
  return (
    <VStack alignment="leading" spacing={10} modifiers={[padding({ all: 4 })]}>
      <Text modifiers={[font({ size: 17, weight: 'bold' }), foregroundStyle('#0A84FF')]}>xopc</Text>
      <Text modifiers={[font({ size: 13, weight: 'medium' }), foregroundStyle(secondary)]}>
        Focus on what needs you now.
      </Text>
      <Spacer />
      <HStack spacing={14}>
        <Link label="Capture" destination="xopc://inbox?capture=1" />
        <Link label="Briefing" destination="xopc:///" />
      </HStack>
    </VStack>
  );
}

export default createWidget('QuickEntryWidget', QuickEntryWidget);
