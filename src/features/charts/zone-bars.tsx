/** HR-zone minutes as five proportional bars (Strain detail). Plain RN views. */
import { StyleSheet, View } from 'react-native';

import { ThemedText } from '@/components/themed-text';
import { STRAIN_BLUE } from './colors';
import { Spacing } from '@/constants/theme';

const ZONE_LABELS = ['Z1', 'Z2', 'Z3', 'Z4', 'Z5'];

export function ZoneBars({ zoneMinutes }: { zoneMinutes: number[] }) {
  const max = Math.max(1, ...zoneMinutes);
  return (
    <View style={styles.container}>
      {ZONE_LABELS.map((label, i) => {
        const minutes = zoneMinutes[i] ?? 0;
        return (
          <View key={label} style={styles.row}>
            <ThemedText type="small" style={styles.label}>{label}</ThemedText>
            <View style={styles.track}>
              <View
                style={[
                  styles.fill,
                  { width: `${(minutes / max) * 100}%`, opacity: 0.4 + 0.12 * i },
                ]}
              />
            </View>
            <ThemedText type="small" style={styles.value}>{Math.round(minutes)}m</ThemedText>
          </View>
        );
      })}
    </View>
  );
}

const styles = StyleSheet.create({
  container: { gap: Spacing.two, alignSelf: 'stretch' },
  row: { flexDirection: 'row', alignItems: 'center', gap: Spacing.two },
  label: { width: 28 },
  track: { flex: 1, height: 10, borderRadius: 5, backgroundColor: `${STRAIN_BLUE}22`, overflow: 'hidden' },
  fill: { height: '100%', borderRadius: 5, backgroundColor: STRAIN_BLUE },
  value: { width: 40, textAlign: 'right' },
});
