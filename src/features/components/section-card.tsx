/** A titled card surface used across the Goose screens. */
import { type ReactNode } from 'react';
import { StyleSheet, View } from 'react-native';

import { ThemedText } from '@/components/themed-text';
import { ThemedView } from '@/components/themed-view';
import { Spacing } from '@/constants/theme';

interface SectionCardProps {
  title: string;
  subtitle?: string;
  children?: ReactNode;
}

export function SectionCard({ title, subtitle, children }: SectionCardProps) {
  return (
    <ThemedView type="backgroundElement" style={styles.card}>
      <View style={styles.header}>
        <ThemedText type="smallBold">{title}</ThemedText>
        {subtitle ? <ThemedText type="small">{subtitle}</ThemedText> : null}
      </View>
      {children}
    </ThemedView>
  );
}

/** A large value with a caption, e.g. a live metric readout. */
export function MetricReadout({ value, caption }: { value: string; caption: string }) {
  return (
    <View style={styles.readout}>
      <ThemedText type="title">{value}</ThemedText>
      <ThemedText type="small">{caption}</ThemedText>
    </View>
  );
}

const styles = StyleSheet.create({
  card: {
    alignSelf: 'stretch',
    gap: Spacing.three,
    padding: Spacing.three,
    borderRadius: Spacing.four,
  },
  header: { gap: Spacing.half },
  readout: { gap: Spacing.half, alignItems: 'flex-start' },
});
