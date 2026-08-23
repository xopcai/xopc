import { HStack, Image, ProgressView, Spacer, Text, VStack } from '@expo/ui/swift-ui';
import {
  font,
  foregroundStyle,
  padding,
  progressViewStyle,
  tint,
} from '@expo/ui/swift-ui/modifiers';
import { createLiveActivity } from 'expo-widgets';

import type { ReadAloudLiveActivityProps } from '../features/voice/read-aloud-live-activity.types';

const ACCENT = '#0A84FF';

function statusIcon(status: ReadAloudLiveActivityProps['status']) {
  if (status === 'preparing') return 'waveform';
  if (status === 'paused') return 'pause.fill';
  return 'speaker.wave.2.fill';
}

function ReadAloudLiveActivityView(props: ReadAloudLiveActivityProps) {
  'widget';
  const secondary = '#AEB7C6';
  const icon = statusIcon(props.status);

  return {
    banner: (
      <HStack spacing={12} modifiers={[padding({ all: 14 })]}>
        <Image systemName={icon} size={22} color={ACCENT} />
        <VStack alignment="leading" spacing={5}>
          <Text modifiers={[font({ size: 15, weight: 'semibold' })]}>{props.title}</Text>
          <Text modifiers={[font({ size: 12 }), foregroundStyle(secondary)]}>{props.detail}</Text>
          <ProgressView
            value={props.progress}
            modifiers={[progressViewStyle('linear'), tint(ACCENT)]}
          />
        </VStack>
        <Spacer />
        <Text modifiers={[font({ size: 13, weight: 'bold' }), foregroundStyle(ACCENT)]}>xopc</Text>
      </HStack>
    ),
    compactLeading: <Image systemName={icon} size={16} color={ACCENT} />,
    compactTrailing: (
      <Text modifiers={[font({ size: 11, weight: 'semibold' }), foregroundStyle(ACCENT)]}>
        {props.detail.split(' · ')[0]}
      </Text>
    ),
    minimal: <Image systemName={icon} size={15} color={ACCENT} />,
    expandedLeading: <Image systemName={icon} size={20} color={ACCENT} />,
    expandedTrailing: (
      <Text modifiers={[font({ size: 12, weight: 'bold' }), foregroundStyle(ACCENT)]}>xopc</Text>
    ),
    expandedCenter: (
      <VStack alignment="leading" spacing={4} modifiers={[padding({ horizontal: 8 })]}>
        <Text modifiers={[font({ size: 14, weight: 'semibold' })]}>{props.title}</Text>
        <Text modifiers={[font({ size: 11 }), foregroundStyle(secondary)]}>{props.detail}</Text>
      </VStack>
    ),
    expandedBottom: (
      <ProgressView
        value={props.progress}
        modifiers={[padding({ horizontal: 8, bottom: 4 }), progressViewStyle('linear'), tint(ACCENT)]}
      />
    ),
  };
}

export const ReadAloudLiveActivity = createLiveActivity<ReadAloudLiveActivityProps>(
  'ReadAloudLiveActivity',
  ReadAloudLiveActivityView,
);
