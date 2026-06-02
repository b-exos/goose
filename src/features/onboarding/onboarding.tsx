/**
 * First-run onboarding overlay (welcome → permissions → connect).
 *
 * Rendered full-screen over the tab navigator until completed. Mirrors the original
 * SwiftUI onboarding steps; permission requests are wired to expo-location/notifications in
 * a follow-up — here each step explains what's next and advances.
 */
import { StyleSheet, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { ThemedText } from '@/components/themed-text';
import { ThemedView } from '@/components/themed-view';
import { Spacing } from '@/constants/theme';
import { UiButton } from '@/features/components/ui-button';
import { useOnboardingStore, type OnboardingStep } from '@/state/onboarding-store';

interface StepContent {
  title: string;
  body: string;
  cta: string;
}

const STEP_CONTENT: Record<OnboardingStep, StepContent> = {
  welcome: {
    title: 'Welcome to Goose',
    body: 'A local-first companion for your WHOOP 5.0 band. Your data stays on your device and is analyzed on-device.',
    cta: 'Get started',
  },
  permissions: {
    title: 'Permissions',
    body: 'Goose needs Bluetooth to talk to your band, and optionally Location and Notifications for workouts and overnight syncs.',
    cta: 'Continue',
  },
  connect: {
    title: 'Connect your band',
    body: 'When you finish, head to the More tab to scan for and connect your WHOOP 5.0.',
    cta: 'Finish',
  },
};

export function Onboarding() {
  const step = useOnboardingStore((s) => s.step);
  const next = useOnboardingStore((s) => s.next);
  const content = STEP_CONTENT[step];

  return (
    <ThemedView style={styles.container}>
      <SafeAreaView style={styles.safeArea}>
        <View style={styles.body}>
          <ThemedText type="title">{content.title}</ThemedText>
          <ThemedText type="default">{content.body}</ThemedText>
        </View>
        <UiButton label={content.cta} onPress={next} />
      </SafeAreaView>
    </ThemedView>
  );
}

const styles = StyleSheet.create({
  container: { position: 'absolute', top: 0, left: 0, right: 0, bottom: 0 },
  safeArea: { flex: 1, padding: Spacing.four, justifyContent: 'space-between' },
  body: { flex: 1, justifyContent: 'center', gap: Spacing.three },
});
